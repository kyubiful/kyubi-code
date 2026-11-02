import { expect, test } from 'bun:test'
import { z } from 'zod'
import { MockProvider, type MockScript } from '../providers/mock'
import { echoTool } from '../tools/echo'
import { Agent } from './agent'
import type { AgentEvent } from './events'
import { ProviderError, type Provider } from './provider'
import { defineTool, ToolRegistry, type AnyTool } from './tools'

function makeAgent(
  script: MockScript | Provider,
  tools: AnyTool[] = [echoTool],
) {
  const provider =
    Array.isArray(script) || typeof script === 'function'
      ? new MockProvider(script)
      : script

  return new Agent({
    provider,
    model: 'mock',
    tools: new ToolRegistry(tools),
    system: 'test',
    cwd: '.',
    maxTurns: 5,
    retryBaseMs: 0,
  })
}

async function collect(events: AsyncIterable<AgentEvent>) {
  return Array.fromAsync(events)
}

const signal = () => new AbortController().signal

test('solo text: un turno', async () => {
  const agent = makeAgent([{ text: 'hola' }])
  const events = await collect(agent.run('hi', signal()))
  expect(events.filter((e) => e.type === 'turn_start')).toHaveLength(1)
  expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' })
  expect(agent.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  expect(agent.messages[1]!.content).toEqual([{ type: 'text', text: 'hola' }])
})

test('una tool que lanza: el modelo recibe isError y el loop sigue', async () => {
  const boom = defineTool({
    name: 'boom',
    description: '',
    schema: z.object({}),
    readOnly: true,
    async execute() {
      throw new Error('fallo')
    },
  })

  const agent = makeAgent(
    [{ toolCalls: [{ name: 'boom', input: {} }] }, { text: 'vale' }],
    [boom],
  )

  const events = await collect(agent.run('hi', signal()))

  expect(agent.messages[2]!.content[0]).toMatchObject({
    type: 'tool_result',
    isError: true,
    content: 'Error: fallo',
  })
  expect(events.at(-1)).toMatchObject({
    type: 'done',
    reason: 'completed',
  })
})

test('abort a mitad del stream: para limpio', async () => {
  const controller = new AbortController()
  const agent = new Agent({
    provider: new MockProvider([{ text: 'un texto bastante largo' }], 5),
    model: 'mock',
    tools: new ToolRegistry(),
    system: '',
    cwd: '.',
  })

  const events: AgentEvent[] = []
  for await (const ev of agent.run('hi', controller.signal)) {
    events.push(ev)
    if (ev.type === 'text_delta') controller.abort()
  }

  expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'aborted' })
  // se guarda el texto parcial
  expect(agent.messages[1]!.content[0]).toMatchObject({ type: 'text' })
})

test('abort con tool_use pendiente: se rellena su tool_result', async () => {
  const controller = new AbortController()
  const slow = defineTool({
    name: 'slow',
    description: '',
    schema: z.object({}),
    readOnly: false, // en serie la segunda no llega a empezar
    async execute() {
      controller.abort()
      return 'tarde'
    },
  })

  const agent = makeAgent(
    [
      {
        toolCalls: [
          { name: 'slow', input: {} },
          { name: 'slow', input: {} },
        ],
      },
    ],
    [slow],
  )

  const events = await collect(agent.run('hi', controller.signal))
  expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'aborted' })
  const results = agent.messages[2]!.content
  expect(results).toHaveLength(2)
  expect(results[1]).toMatchObject({ content: 'Cancelado por el usuario' })
})

test('maxTurns alcanzado', async () => {
  const agent = makeAgent(() => ({
    toolCalls: [{ name: 'echo', input: { text: 'otra vez' } }],
  }))
  const events = await collect(agent.run('hi', signal()))
  expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'max_turns' })
})

test('reintenta errores temporales del provider', async () => {
  let calls = 0
  const flaky: Provider = {
    id: 'flaky',
    models: () => [],
    async *stream() {
      calls++
      if (calls < 3) throw new ProviderError('saturado', 'overloaded', true)
      yield { type: 'text_delta', text: 'por fin' }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }
  const agent = makeAgent(flaky)
  const events = await collect(agent.run('hi', signal()))

  expect(calls).toBe(3)
  expect(events.filter((e) => e.type === 'error')).toHaveLength(2)
  expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' })
})

test('un error no reintentable termina con done: error', async () => {
  const broken: Provider = {
    id: 'broken',
    models: () => [],
    async *stream() {
      throw new ProviderError('token inválido', 'auth', false)
    },
  }
  const agent = makeAgent(broken)
  const events = await collect(agent.run('hi', signal()))
  expect(events.at(-2)).toMatchObject({
    type: 'error',
    error: 'token inválido',
  })
  expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'error' })
})

test('todos los eventos llevan el agentId', async () => {
  const agent = makeAgent([{ text: 'x' }])
  const events = await collect(agent.run('hi', signal()))
  expect(events.every((e) => e.agentId === 'main')).toBe(true)
})
