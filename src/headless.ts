// Modo headless
import { createInterface } from 'node:readline/promises'
import type { PermissionMode, PermissionRequest } from './core/permissions'
import type { QuestionAnswer, QuestionRequest } from './core/questions'
import { formatTokens } from './core/usage'
import { Harness } from './harness'

export type HeadlessOptions = {
  prompt: string
  provider?: string
  model?: string
  mode?: PermissionMode
  interactive: boolean // false: las preguntas de permisos se deniegan solas
  resume?: string // id de la sesión o 'latest'
}

export async function runHeadless(opts: HeadlessOptions): Promise<void> {
  const harness = await Harness.create({
    cwd: process.cwd(),
    overrides: {
      provider: opts.provider,
      model: opts.model,
      permissions: { mode: opts.mode },
    },
    interactive: opts.interactive,
    resume: opts.resume,
  })
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())

  let ok = true
  for await (const ev of harness.submit(opts.prompt, controller.signal)) {
    switch (ev.type) {
      case 'text_delta':
        process.stdout.write(ev.text)
        break
      case 'turn_end':
        process.stdout.write('\n')
        break
      case 'tool_start':
        console.error(`-> ${ev.name} ${JSON.stringify(ev.input)}`)
        break
      case 'tool_end':
        console.error(
          `${ev.isError ? '✗' : '✓'} ${ev.name} (${ev.durationMs}ms)`,
        )
        break
      case 'permission_request':
        await askPermission(ev.request)
        break
      case 'question_request':
        await askQuestions(ev.request)
        break
      case 'tasks_updated':
        console.error(
          `Tareas: ${ev.tasks.map((t) => `${t.id}:${t.status}`).join(' ')}`,
        )
        break
      case 'notice':
        if (ev.level === 'error') console.error(ev.text)
        else console.log(ev.text)
        break
      case 'error':
        console.error(`${ev.retryable ? 'Reintentando' : 'Error'}: ${ev.error}`)
        break
      case 'done':
        ok = ev.reason === 'completed'
        if (!ok) console.error(`(terminando: ${ev.reason})`)
        break
    }
  }
  const { total } = harness.usage
  const context = harness.usage.context(harness.model)
  console.error(
    `tokens: in ${formatTokens(total.inputTokens)} (cached ${formatTokens(total.cachedTokens ?? 0)})` +
      ` / out ${formatTokens(total.outputTokens)} - ${context.percent}% de contexto`,
  )
  await harness.session.flush()
  console.error(`sesión: ${harness.session.id}`)
  if (!ok) process.exitCode = 1
}

async function askPermission(request: PermissionRequest): Promise<void> {
  const what = request.target
    ? `${request.toolName}(${request.target})`
    : request.toolName
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = (
    await rl.question(`¿Permitir ${what}? [s]í / [a] siempre / [N]o: `)
  )
    .trim()
    .toLowerCase()
  rl.close()
  if (answer === 's' || answer === 'si' || answer === 'y')
    request.respond('allow_once')
  else if (answer === 'a') request.respond('allow_always')
  else request.respond('deny')
}

// Muestra cada pregunta con sus opciones numeradas. Se responde con números
// separados por comas ("1" o "1,3") o con texto libre
async function askQuestions(request: QuestionRequest): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answers: QuestionAnswer[] = []
  for (const q of request.questions) {
    console.error(`\n${q.question}`)
    q.options.forEach((option, i) => {
      const desc = option.description ? `- ${option.description}` : ''
      console.error(`  ${i + 1}. ${option.label}${desc}`)
    })
    const hint = q.multiSelect ? 'números separados por comas' : 'un número'
    const raw = (
      await rl.question(`Respuesta (${hint}, o escribe otra cosa): `)
    ).trim()
    const picked = raw
      .split(',')
      .map((part) => q.options[Number(part.trim()) - 1]?.label)
    if (raw && picked.every(Boolean)) {
      answers.push({ question: q.question, selected: picked as string[] })
    } else {
      answers.push({ question: q.question, selected: [], other: raw })
    }
  }
  rl.close()
  request.respond(answers)
}
