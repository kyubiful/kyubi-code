// Aqui juntamos todas las piezas (provider, tools, agent...) y es lo único que
// usan la TUI y el modo headless. Si algo se puede hacer desde la TUI, se hace
// llamando a un métido de aquí, así que también funciona en headless

import { builtinCommands } from './commands/builtin'
import { loadCustomCommands } from './commands/custom'
import { CommandRegistry, parseCommand } from './commands/index'
import type { Command } from './commands/types'
import { Agent } from './core/agent'
import { Channel } from './core/channel'
import {
  configPaths,
  loadConfig,
  type Config,
  type ConfigInput,
} from './core/config'
import { buildSystemPrompt } from './core/context'
import type { AgentEvent, AgentEventBody } from './core/events'
import { Permissions, type PermissionMode } from './core/permissions'
import { findModel, type ModelInfo, type Provider } from './core/provider'
import { TaskStore } from './core/tasks'
import { ToolRegistry, errorMessage } from './core/tools'
import { type Message } from './core/types'
import { UsageTracker } from './core/usage'
import { createProvider } from './providers'
import { SessionStore } from './session/store'
import { buildinTools } from './tools'
import { echoTool } from './tools/echo'
import { questionTool } from './tools/question'
import { taskTools } from './tools/tasks'
import { webTools } from './tools/web'

export type HarnessOptions = {
  config: Config
  cwd: string
  provider?: Provider // id o una instancia (los tests pasan un MockProvider)
  system?: string // system prompt (create() lo construye con buildSystemPrompt)
  interactive?: boolean // false: nadie puede responder a las preguntas de permisos
  commands?: Command[] // comandos .md del usuario y del proyecto
  session?: SessionStore // sesión retomada. Si no, se crea una nueva
}

export type CreateOption = {
  cwd: string
  overrides?: ConfigInput // flags de la CLI
  interactive?: boolean
  resume?: string // id de la sesión, o 'latest' para la más reciente (--continue)
}

export class Harness {
  readonly config: Config
  readonly cwd: string
  readonly system: string
  readonly tools: ToolRegistry
  readonly permissions: Permissions
  readonly commands: CommandRegistry
  readonly usage = new UsageTracker()
  readonly tasks = new TaskStore()
  // Cambian con /model y /clear y /resume
  provider: Provider
  model: ModelInfo
  agent: Agent
  session: SessionStore

  // Carga la configuración y crea el harness (lo que usan la CLI y la TUI)
  static async create(opts: CreateOption): Promise<Harness> {
    const { cwd, overrides, interactive } = opts
    const config = await loadConfig(cwd, overrides)
    const system = await buildSystemPrompt(cwd)
    const commands = await loadCustomCommands(cwd)
    let session: SessionStore | undefined
    if (opts.resume === 'latest') {
      session = (await SessionStore.latest(cwd)) ?? undefined
    } else if (opts.resume) {
      session = await SessionStore.find(cwd, opts.resume)
    }
    return new Harness({
      config,
      cwd,
      interactive,
      system,
      commands,
      session,
    })
  }

  constructor(opts: HarnessOptions) {
    this.config = opts.config
    this.cwd = opts.cwd
    this.system = opts.system ?? 'Eres un asistente de programación.'
    this.provider = opts.provider ?? createProvider(this.config.provider)
    this.model = findModel(
      this.provider,
      this.config.model ?? this.provider.models()[0]!.id,
    )
    // Las variables de `env` de la config llegan así a los comandos de bash
    Object.assign(process.env, this.config.env)

    this.tools = new ToolRegistry([
      ...buildinTools(),
      ...webTools(),
      questionTool,
      ...taskTools(this.tasks),
      // echo solo hace falta para el guion por defecto del mock
      ...(this.provider.id === 'mock' ? [echoTool] : []),
    ])
    this.permissions = new Permissions(
      this.config.permissions,
      configPaths(this.cwd).local,
      opts.interactive ?? true,
    )
    this.commands = new CommandRegistry([
      ...builtinCommands(),
      ...(opts.commands ?? []),
    ])
    this.session = opts.session ?? SessionStore.create(this.cwd)
    this.tasks.tasks = this.session.tasks()
    this.agent = this.createAgent(this.session.messages())
  }

  private createAgent(messages: Message[]): Agent {
    return new Agent({
      provider: this.provider,
      model: this.model.id,
      tools: this.tools,
      system: this.system,
      cwd: this.cwd,
      sessionId: this.session.id,
      permissions: this.permissions,
      reminder: () => this.tasks.reminder(),
      messages,
    })
  }

  // Mensaje escrito mientras el agente trabaja: se entrega al final del turno
  enqueue(text: string): void {
    this.agent.enqueue(text)
  }

  // default -> acceptEdits -> plan -> default (shift+tab en la TUI)
  cycleMode(): PermissionMode {
    const modes: PermissionMode[] = ['default', 'acceptEdits', 'plan']
    const next =
      modes[(modes.indexOf(this.permissions.mode) + 1) % modes.length]!
    this.permissions.mode = next
    return next
  }

  // "openai/gpt-5.2" cambia de provider y modelo. "gpt-5.2", solo de modelo
  // La conversación se conserva
  switchModel(spec: string): void {
    const [providerId, modelId] = spec.includes('/')
      ? spec.split('/', 2)
      : [this.provider.id, spec]
    if (providerId !== this.provider.id) {
      this.provider = createProvider(providerId!)
    }
    this.model = findModel(
      this.provider,
      modelId || this.provider.models()[0]!.id,
    )
    this.agent = this.createAgent(this.agent.messages)
  }

  // Conversación nueva
  clear(): void {
    this.loadSession(SessionStore.create(this.cwd))
  }

  // Cambia a otra sesión (nueva o retomada)
  loadSession(session: SessionStore): void {
    this.session = session
    this.tasks.tasks = session.tasks()
    this.usage.reset()
    this.agent = this.createAgent(session.messages())
  }

  // Lo que pasa cuando el usuario envía un mensaje
  async *submit(text: string, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const command = parseCommand(text)
    if (command && this.commands.get(command.name)) {
      const prompt = yield* this.runCommand(command.name, command.args)
      if (prompt === undefined) return
      text = prompt
    }
    for await (const event of this.agent.run(text, signal)) {
      this.record(event)
      yield event
    }
  }

  // Lo que hay que guardar en cada evento
  private record(event: AgentEvent): void {
    if (event.parentAgentId) return // los subagentes tienen su propia sesión
    switch (event.type) {
      case 'message_added':
        this.session.append({ type: 'message', message: event.message })
        break
      case 'usage':
        this.usage.add(event.usage)
        this.session.append({
          type: 'usage',
          usage: event.usage,
          model: this.model.id,
        })
        break
      case 'tasks_updated':
        this.session.append({ type: 'tasks', tasks: event.tasks })
    }
  }

  // Ejecuta un comando. Su salida llega como eventos `notice`.
  // Devuelve el prompt a enviar al agente si el comando lo pide.
  private async *runCommand(
    name: string,
    args: string,
  ): AsyncGenerator<AgentEvent, string | undefined> {
    const channel = new Channel<AgentEvent>()
    const emit = (body: AgentEventBody) =>
      channel.push({ ...body, agentId: 'main' })
    let prompt: string | undefined
    const sessionBefore = this.session

    this.commands
      .get(name)!
      .run({
        args,
        harness: this,
        print: (text, level = 'info') => emit({ type: 'notice', level, text }),
      })
      .then((result) => {
        // /clear, /resume...: si cambió la sesión, la TUI tiene que redibujarse
        if (this.session !== sessionBefore) {
          emit({ type: 'session_loaded', messages: this.agent.messages })
        }
        if (result.type === 'prompt') prompt = result.prompt
      })
      .catch((error) =>
        emit({ type: 'notice', level: 'error', text: errorMessage(error) }),
      )
      .finally(() => channel.close())

    yield* channel
    return prompt
  }
}
