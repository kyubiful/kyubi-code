import { expect, test } from 'bun:test'
import { Agent } from '../core/agent.ts'
import type { AgentEvent } from '../core/events.ts'
import { Permissions } from '../core/permissions.ts'
import { TaskStore } from '../core/tasks.ts'
import { ToolRegistry } from '../core/tools.ts'
import { MockProvider, type MockTurn } from '../providers/mock.ts'
import { questionTool } from './question.ts'
import { taskTools } from './tasks.ts'

const question = {
  question: '¿Qué framework de tests?',
  header: 'Tests',
  options: [{ label: 'bun test' }, { label: 'vitest' }],
}

function agent(
  script: MockTurn[],
  store = new TaskStore(),
  interactive = true,
) {
  const provider = new MockProvider(script)
  const a = new Agent({
    provider,
    model: 'mock',
    tools: new ToolRegistry([questionTool, ...taskTools(store)]),
    system: '',
    cwd: '.',
    permissions: new Permissions(
      { mode: 'default', allow: [], ask: [], deny: [] },
      undefined,
      interactive,
    ),
    reminder: () => store.reminder(),
  })
  return { a, provider, store }
}

async function run(a: Agent, onEvent: (ev: AgentEvent) => void = () => {}) {
  const events: AgentEvent[] = []
  for await (const ev of a.run('añade tests', new AbortController().signal)) {
    events.push(ev)
    onEvent(ev)
  }
  return events
}

test('question: la respuesta del usuario le llega al modelo', async () => {
  const { a } = agent([
    { toolCalls: [{ name: 'question', input: { questions: [question] } }] },
    { text: 'ok' },
  ])
  await run(a, (ev) => {
    if (ev.type === 'question_request') {
      ev.request.respond([
        { question: question.question, selected: ['bun test'] },
      ])
    }
  })
  expect(a.messages[2]!.content[0]).toMatchObject({
    type: 'tool_result',
    content: '"¿Qué framework de tests?" → bun test',
    isError: false,
  })
})

test('question: si el usuario cancela, devuelve isError', async () => {
  const { a } = agent([
    { toolCalls: [{ name: 'question', input: { questions: [question] } }] },
    { text: 'ok' },
  ])
  await run(a, (ev) => {
    if (ev.type === 'question_request') ev.request.respond(null)
  })
  expect(a.messages[2]!.content[0]).toMatchObject({
    isError: true,
    content: 'Error: El usuario ha cancelado la pregunta',
  })
})

test('question: sin interactividad, el modelo debe decidir solo', async () => {
  const { a } = agent(
    [
      { toolCalls: [{ name: 'question', input: { questions: [question] } }] },
      { text: 'ok' },
    ],
    new TaskStore(),
    false,
  )
  const events = await run(a)
  expect(events.some((e) => e.type === 'question_request')).toBe(false)
  expect(a.messages[2]!.content[0]).toMatchObject({ isError: true })
})

test('tasks: crear, empezar y completar respetando dependencias', async () => {
  const { a, store, provider } = agent([
    {
      toolCalls: [
        { name: 'task_create', input: { subject: 'Escribir tests' } },
        {
          name: 'task_create',
          input: { subject: 'Ejecutarlos', blockedBy: ['1'] },
        },
      ],
    },
    {
      toolCalls: [
        { name: 'task_update', input: { id: '2', status: 'in_progress' } },
      ],
    },
    {
      toolCalls: [
        { name: 'task_update', input: { id: '1', status: 'in_progress' } },
      ],
    },
    {
      toolCalls: [
        { name: 'task_update', input: { id: '1', status: 'completed' } },
      ],
    },
    { text: 'hecho' },
  ])
  const events = await run(a)
  // La tarea 2 está bloqueada por la 1
  expect(a.messages[4]!.content[0]).toMatchObject({ isError: true })
  expect(store.tasks.map((t) => t.status)).toEqual(['completed', 'pending'])
  expect(store.tasks[0]!.owner).toBe('main')
  expect(events.filter((e) => e.type === 'tasks_updated').length).toBe(4)
  // Mientras había tareas abiertas, cada petición llevaba el recordatorio
  const lastRequest = provider.requests.at(-1)!
  expect(JSON.stringify(lastRequest.messages.at(-1))).toContain('recordatorio')
  // ...pero no se guarda en el historial
  expect(JSON.stringify(a.messages)).not.toContain('recordatorio')
})

test('TaskStore: solo una tarea en curso por agente', () => {
  const store = new TaskStore()
  store.create({ subject: 'a' })
  store.create({ subject: 'b' })
  store.update('1', { status: 'in_progress', owner: 'main' })
  expect(() =>
    store.update('2', { status: 'in_progress', owner: 'main' }),
  ).toThrow('ya está en curso')
  expect(() =>
    store.update('2', { status: 'in_progress', owner: 'sub' }),
  ).not.toThrow()
})
