// El agent loop: llama al modelo, ejecuta las tools y repite
import type { HookRunner } from '../hooks/runner'
import { Channel } from './channel'
import type { PermissionAnswer, Permissions } from './permissions'
import type { QuestionAnswer } from './questions'
import { Mutex } from './mutex'
import type { AgentEvent, AgentEventBody } from './events'
import { ProviderError, type Provider, type StopReason } from './provider'
import { errorMessage, type ToolContext, type ToolRegistry } from './tools'
import {
  newId,
  userMessage,
  type ContentBlock,
  type Message,
  type Usage,
} from './types'

export type AgentOptions = {
  provider: Provider
  model: string
  tools: ToolRegistry
  system: string
  cwd: string
  maxTurns?: number
  agentId?: string
  parentAgentId?: string
  messages?: Message[] // historial previo
  retryBaseMs?: number // espera antes del primer reintento
  sessionId?: string // se pasa al provider para la caché de prompts
  permissions?: Permissions // sin permisos (tests), todo se permite
  // Texto que se aade al final de cada petición sin guardarlo en el historial
  // (ej. el recordatorio de tareas abiertas)
  reminder?: () => string | undefined
  hooks?: HookRunner
  // Antes de cada llamada al modelo: si devuelve algo, el historial se sustituye por
  // la versión compactada. Lo decide el harness, que conoce la config
  maybeCompact?: (
    messages: Message[],
    lastUsage: Usage | undefined,
    signal: AbortSignal,
  ) => Promise<Compacted | undefined>
}

export type Compacted = {
  messages: Message[]
  summary: string
  summaryId: string
  firstKeptId: string | null
}

// Lo que la TUI y los subagentes necesitan de un agente.
export interface AgentRunner {
  run(input: string, signal: AbortSignal): AsyncIterable<AgentEvent>
  readonly messages: readonly Message[]
}

type Emit = (event: AgentEventBody) => void
type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>
type ToolResultBlock = Extract<ContentBlock, { type: 'tool_result' }>

const MAX_RETRIES = 3

export class Agent implements AgentRunner {
  readonly id: string
  messages: Message[]
  // Mesnajes que el usuario escribe mientras el agente trabaja
  private queued: string[] = []
  // Un solo diálogo con el usuario a la vez
  private dialogs = new Mutex()
  // Uso del último turno: decide si hay que compactar
  private lastUsage: Usage | undefined

  constructor(private opts: AgentOptions) {
    this.id = opts.agentId ?? 'main'
    this.messages = opts.messages ?? []
  }

  run(input: string, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const channel = new Channel<AgentEvent>()
    const emit: Emit = (event) =>
      channel.push({
        ...event,
        agentId: this.id,
        parentAgentId: this.opts.parentAgentId,
      })

    this.loop(input, signal, emit)
      .catch((error) => {
        emit({ type: 'error', error: errorMessage(error), retryable: false })
        emit({ type: 'done', reason: 'error' })
      })
      .finally(() => channel.close())

    return channel
  }

  // Añade un mensaje del usuario que se entregará al modelo al final del turno actual
  enqueue(text: string): void {
    this.queued.push(text)
  }

  private async loop(input: string, signal: AbortSignal, emit: Emit) {
    this.addMessage(userMessage(input), emit)
    const maxTurns = this.opts.maxTurns ?? 50

    for (let turn = 1; turn <= maxTurns; turn++) {
      await this.compactIfNeeded(signal, emit)
      emit({ type: 'turn_start', turn })
      const { blocks, stopReason } = await this.streamTurn(signal, emit)
      if (blocks.length) {
        this.addMessage(
          { id: newId(), role: 'assistant', content: blocks },
          emit,
        )
      }
      emit({ type: 'turn_end', turn, stopReason })

      const toolUses = blocks.filter((block) => block.type === 'tool_use')
      if (toolUses.length) {
        // Cada tool_use necesita SIEMPRE su tool_result, también si se cancela
        const results: ContentBlock[] = await this.runTools(
          toolUses,
          signal,
          emit,
        )
        // Los mensajes en cola viajan junto a los resultados
        for (const text of this.takeQueued())
          results.push({ type: 'text', text })
        this.addMessage({ id: newId(), role: 'user', content: results }, emit)
      }
      if (signal.aborted) return emit({ type: 'done', reason: 'aborted' })
      if (!toolUses.length) {
        // Si el usuario escribió mientras el modelo respondía, se sigue con eso
        const queued = this.takeQueued()
        if (!queued.length) return emit({ type: 'done', reason: 'completed' })
        this.addMessage(userMessage(queued.join('\n\n')), emit)
      }
    }
    emit({ type: 'done', reason: 'max_turns' })
  }

  // Una llamada al modelo. Acumula los eventos en bloques y las reenvía a la TUI
  private async streamTurn(
    signal: AbortSignal,
    emit: Emit,
  ): Promise<{ blocks: ContentBlock[]; stopReason: StopReason }> {
    for (let attempt = 1; ; attempt++) {
      const blocks: ContentBlock[] = []
      let stopReason: StopReason = 'end_turn'
      let streamed = false
      try {
        const stream = this.opts.provider.stream(
          {
            model: this.opts.model,
            system: this.opts.system,
            messages: this.withReminder(),
            tools: this.opts.tools.specs(),
            sessionId: this.opts.sessionId,
          },
          signal,
        )

        for await (const event of stream) {
          streamed = true
          switch (event.type) {
            case 'text_delta': {
              const last = blocks.at(-1)
              if (last?.type === 'text') last.text += event.text
              else blocks.push({ type: 'text', text: event.text })
              emit(event)
              break
            }
            case 'thinking_delta': {
              const last = blocks.at(-1)
              if (last?.type === 'thinking') last.text += event.text
              else blocks.push({ type: 'thinking', text: event.text })
              emit(event)
              break
            }
            case 'thinking_end': {
              const last = blocks.at(-1)
              if (last?.type === 'thinking')
                last.providerData = event.providerData
              else
                blocks.push({
                  type: 'thinking',
                  text: '',
                  providerData: event.providerData,
                })
              break
            }
            case 'tool_use':
              blocks.push({ ...event, type: 'tool_use' })
              break
            case 'usage':
              this.lastUsage = event.usage
              emit(event)
              break
            case 'done':
              stopReason = event.stopReason
              break
          }
        }
        return { blocks, stopReason }
      } catch (error) {
        // Cancelado por el usuario: nos quedamos con lo que haya llegado
        if (signal.aborted) return { blocks, stopReason: 'aborted' }
        // Reintentar solo si es un error temporal y aún no se ha emitido nada
        const retryable =
          error instanceof ProviderError && error.retryable && !streamed
        if (!retryable || attempt >= MAX_RETRIES) throw error
        emit({ type: 'error', error: errorMessage(error), retryable: true })
        await sleep(
          (this.opts.retryBaseMs ?? 1000) * 2 ** (attempt - 1),
          signal,
        )
      }
    }
  }

  private async compactIfNeeded(signal: AbortSignal, emit: Emit) {
    const compacted = await this.opts.maybeCompact?.(
      this.messages,
      this.lastUsage,
      signal,
    )
    if (!compacted) return
    const tokensBefore =
      (this.lastUsage?.inputTokens ?? 0) + (this.lastUsage?.outputTokens ?? 0)
    this.messages = compacted.messages
    this.lastUsage = undefined
    emit({
      type: 'compaction',
      summary: compacted.summary,
      summaryId: compacted.summaryId,
      firstKeptId: compacted.firstKeptId,
      tokensBefore,
    })
  }

  // Las tools de solo lectura seguidas se ejecutan en pralelo. Las que escriben,
  // una a una y en orden (dos edits al mismo archivo a la vez se pisarían)
  private async runTools(
    toolUses: ToolUse[],
    signal: AbortSignal,
    emit: Emit,
  ): Promise<ToolResultBlock[]> {
    const results: ToolResultBlock[] = []
    let batch: ToolUse[] = []
    const flush = async () => {
      results.push(
        ...(await Promise.all(
          batch.map((use) => this.runTool(use, signal, emit)),
        )),
      )
      batch = []
    }
    for (const use of toolUses) {
      if (this.opts.tools.get(use.name)?.readOnly) {
        batch.push(use)
      } else {
        await flush()
        results.push(await this.runTool(use, signal, emit))
      }
    }
    await flush()
    return results
  }

  private async runTool(
    use: ToolUse,
    signal: AbortSignal,
    emit: Emit,
  ): Promise<ToolResultBlock> {
    if (signal.aborted) return cancelled(use)
    emit({
      type: 'tool_start',
      toolUseId: use.id,
      name: use.name,
      input: use.input,
    })
    const started = performance.now()

    const hooks = this.opts.hooks
    const warn = (warnings?: string[]) =>
      warnings?.forEach((text) =>
        emit({ type: 'notice', level: 'error', text }),
      )
    // PreToolUse: los hooks pueden bloquear la tool o cambiar su input
    let input = use.input
    let blocked: string | undefined
    if (hooks?.has('PreToolUse')) {
      const pre = await hooks.run(
        { event: 'PreToolUse', toolName: use.name, input },
        use.name,
      )
      warn(pre.warnings)
      if (pre.decision === 'block')
        blocked = `Bloqueado por un hook: ${pre.reason ?? ''}`
      if (pre.updatedInput !== undefined) input = pre.updatedInput
    }
    const denied =
      blocked ?? (await this.checkPermission({ ...use, input }, signal, emit))
    const result = denied
      ? { content: denied, isError: true }
      : await this.opts.tools.run(
          use.name,
          input,
          this.toolContext(signal, emit),
        )

    // PostToolUse: los hooks pueden añadir información para el modelo
    if (!denied && hooks?.has('PostToolUse')) {
      const post = await hooks.run(
        {
          event: 'PostToolUse',
          toolName: use.name,
          input,
          result: result.content,
          isError: result.isError,
        },
        use.name,
      )
      warn(post.warnings)
      if (post.additionalContext)
        result.content += `\n\n<hook>\n${post.additionalContext}\n</hook>`
      if (post.decision === 'block')
        result.content += `\n\n<hook>\n${post.reason ?? ''}\n</hook>`
    }

    emit({
      type: 'tool_end',
      toolUseId: use.id,
      name: use.name,
      result: result.content,
      isError: result.isError,
      durationMs: Math.round(performance.now() - started),
    })
    return {
      type: 'tool_result',
      toolUseId: use.id,
      content: result.content,
      isError: result.isError,
    }
  }

  private toolContext(signal: AbortSignal, emit: Emit): ToolContext {
    const interactive = this.opts.permissions?.interactive ?? true
    return {
      cwd: this.opts.cwd,
      signal,
      agentId: this.id,
      emit,
      // Los cambios de archivos viajan como eventos: así llegan a la sesión en orden
      recordFileChange: (change) => emit({ type: 'file_changed', change }),
      ask: interactive
        ? {
            question: (questions) =>
              this.dialogs.run(() =>
                this.askUser<QuestionAnswer[] | null>(signal, null, (respond) =>
                  emit({
                    type: 'question_request',
                    request: { requestId: newId(), questions, respond },
                  }),
                ),
              ),
          }
        : undefined,
    }
  }

  // Copia del historial con el recordatorio añadido al último mensaje del usuario
  private withReminder(): Message[] {
    const reminder = this.opts.reminder?.()
    const last = this.messages.at(-1)
    if (!reminder || last?.role !== 'user') return this.messages
    return [
      ...this.messages.slice(0, 1),
      { ...last, content: [...last.content, { type: 'text', text: reminder }] },
    ]
  }

  // Devuelve null si se puede ejecutar, o el mensaje para el modelo si no
  private async checkPermission(
    use: ToolUse,
    signal: AbortSignal,
    emit: Emit,
  ): Promise<string | null> {
    const permissions = this.opts.permissions
    const tool = this.opts.tools.get(use.name)
    // Sin permisos configurados (tests) o tool inexistente: el registry se encarga
    if (!permissions || !tool) return null
    // Con un input inválido no hay nada que ejecutar: el registry dará el error
    const parsed = tool.schema.safeParse(use.input)
    if (!parsed.success) return null

    const target = tool.permissionTarget?.(parsed.data)
    // Se evalúa dentro del mutex: si mientras esperábamos el usuario respondió
    // "permitir siempre" a una petición igual, ya no hace falta preguntar
    return this.dialogs.run(async () => {
      const decision = permissions.evaluate(tool, target)
      if (decision === 'allow') return null
      if (decision === 'deny' || !permissions.interactive)
        return permissions.denialMessage(tool, false)
      const answer = await this.askUser<PermissionAnswer>(
        signal,
        'deny',
        (respond) =>
          emit({
            type: 'permission_request',
            request: {
              requestId: newId(),
              toolName: use.name,
              input: use.input,
              target,
              respond,
            },
          }),
      )
      if (answer === 'deny') return permissions.denialMessage(tool, true)
      if (answer === 'allow_always')
        await permissions.allowAlways(tool.name, target)
      return null
    })
  }

  // Emite una petición a la TUI y espera a que llame a respond().
  // Si el usuario cancela el turno mientras tanto, se responde `onAbort`.
  private async askUser<T>(
    signal: AbortSignal,
    onAbort: T,
    send: (respond: (answer: T) => void) => void,
  ): Promise<T> {
    if (signal.aborted) return onAbort
    const { promise, resolve } = Promise.withResolvers<T>()
    const abort = () => resolve(onAbort)
    signal.addEventListener('abort', abort, { once: true })
    send(resolve)
    try {
      return await promise
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private takeQueued(): string[] {
    const queued = this.queued
    this.queued = []
    return queued
  }

  private addMessage(message: Message, emit: Emit) {
    this.messages.push(message)
    emit({ type: 'message_added', message })
  }
}

function cancelled(use: ToolUse): ToolResultBlock {
  return {
    type: 'tool_result',
    toolUseId: use.id,
    content: 'Cancelado por el usuario',
    isError: true,
  }
}

// sleep que termina antes si se cancela
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      {
        once: true,
      },
    )
  })
}
