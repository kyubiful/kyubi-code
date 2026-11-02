import { expect, test } from 'bun:test'
import { z } from 'zod'
import { MockProvider } from '../providers/mock.ts'
import { Agent } from './agent.ts'
import type { AgentEvent } from './events.ts'
import { Permissions } from './permissions.ts'
import { defineTool, ToolRegistry, type AnyTool } from './tools.ts'

const slowRead = defineTool({
  name: 'slow_read',
  description: '',
  schema: z.object({ id: z.number() }),
  readOnly: true,
  async execute({ id }, ctx) {
    await Bun.sleep(100)
    return ctx.signal.aborted ? 'cancelado' : `leído ${id}`
  },
})
const write = defineTool({
  name: 'write',
  description: '',
  schema: z.object({ id: z.number() }),
  readOnly: false,
  permissionTarget: (i) => String(i.id),
  async execute({ id }) {
    return `escrito ${id}`
  },
})

function agent(
  script: ConstructorParameters<typeof MockProvider>[0],
  tools: AnyTool[],
  permissions?: Permissions,
) {
  return new Agent({
    provider: new MockProvider(script),
    model: 'mock',
    tools: new ToolRegistry(tools),
    system: '',
    cwd: '.',
    permissions,
  })
}

test('3 tools de solo lectura en paralelo tardan como una', async () => {
  const a = agent(
    [
      {
        toolCalls: [1, 2, 3].map((id) => ({
          name: 'slow_read',
          input: { id },
        })),
      },
      { text: 'ok' },
    ],
    [slowRead],
  )
  const started = performance.now()
  await Array.fromAsync(a.run('hi', new AbortController().signal))
  expect(performance.now() - started).toBeLessThan(250)
  // Los resultados mantienen el orden de las llamadas
  expect(
    a.messages[2]!.content.map((b) => b.type === 'tool_result' && b.content),
  ).toEqual(['leído 1', 'leído 2', 'leído 3'])
})

test('nunca hay dos peticiones de permiso abiertas a la vez', async () => {
  const a = agent(
    [
      { toolCalls: [1, 2].map((id) => ({ name: 'write', input: { id } })) },
      { text: 'ok' },
    ],
    [write],
    new Permissions({ mode: 'default', allow: [], ask: [], deny: [] }),
  )
  let open = 0
  let maxOpen = 0
  for await (const ev of a.run('hi', new AbortController().signal)) {
    if (ev.type === 'permission_request') {
      open++
      maxOpen = Math.max(maxOpen, open)
      setTimeout(() => {
        open--
        ev.request.respond('allow_once')
      }, 20)
    }
  }
  expect(maxOpen).toBe(1)
})

test('el abort a mitad deja la conversación válida para continuar', async () => {
  const controller = new AbortController()
  const a = agent(
    [
      { toolCalls: [1, 2].map((id) => ({ name: 'slow_read', input: { id } })) },
      { text: 'seguimos' },
    ],
    [slowRead],
  )
  setTimeout(() => controller.abort(), 30)
  const events = await Array.fromAsync(a.run('hi', controller.signal))
  expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'aborted' })
  // Cada tool_use tiene su tool_result
  const uses = a.messages[1]!.content.filter((b) => b.type === 'tool_use').map(
    (b) => b.id,
  )
  const results = a.messages[2]!.content.filter(
    (b) => b.type === 'tool_result',
  ).map((b) => b.toolUseId)
  expect(results).toEqual(uses)
  // Y se puede seguir hablando
  const next = await Array.fromAsync(
    a.run('continúa', new AbortController().signal),
  )
  expect(next.at(-1)).toMatchObject({ type: 'done', reason: 'completed' })
})

test('un mensaje en cola se entrega al final del turno', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'slow_read', input: { id: 1 } }] },
    { text: 'visto' },
  ])
  const a = new Agent({
    provider,
    model: 'mock',
    tools: new ToolRegistry([slowRead]),
    system: '',
    cwd: '.',
  })
  const events: AgentEvent[] = []
  for await (const ev of a.run('hi', new AbortController().signal)) {
    events.push(ev)
    if (ev.type === 'tool_start') a.enqueue('y además esto')
  }
  expect(a.messages[2]!.content.at(-1)).toEqual({
    type: 'text',
    text: 'y además esto',
  })
})

test('un mensaje en cola sin tools provoca otro turno', async () => {
  const provider = new MockProvider(
    [{ text: 'primera respuesta' }, { text: 'segunda' }],
    5,
  )
  const a = new Agent({
    provider,
    model: 'mock',
    tools: new ToolRegistry(),
    system: '',
    cwd: '.',
  })
  let queued = false
  for await (const ev of a.run('hi', new AbortController().signal)) {
    if (ev.type === 'text_delta' && !queued) {
      queued = true
      a.enqueue('otra cosa')
    }
  }
  expect(a.messages.map((m) => m.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
  ])
  expect(provider.requests).toHaveLength(2)
})
