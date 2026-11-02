import { expect, test } from 'bun:test'
import { userMessage } from '../core/types'
import { MockProvider } from './mock'

const req = (text: string) => ({
  model: 'mock',
  system: '',
  messages: [userMessage(text)],
  tools: [],
})

test('el mock emite el texto en streaming', async () => {
  const provider = new MockProvider([{ text: 'hola mundo' }])
  let text = ''
  const types: string[] = []
  for await (const ev of provider.stream(
    req('hi'),
    new AbortController().signal,
  )) {
    types.push(ev.type)
    if (ev.type === 'text_delta') text += ev.text
  }

  expect(text).toBe('hola mundo')
  expect(types.filter((t) => t === 'text_delta').length).toBeGreaterThan(1)
  expect(types.at(-1)).toBe('done')
})

test('el mock emite tool_use ya parseado', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'echo', input: { text: 'x' } }] },
  ])
  const events = await Array.fromAsync(
    provider.stream(req('hi'), new AbortController().signal),
  )

  expect(events).toContainEqual({
    type: 'tool_use',
    id: 'mock_tool_1_0',
    name: 'echo',
    input: { text: 'x' },
  })
  expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' })
})

test('el guion por defecto repite lo que dice el usuario', async () => {
  const provider = new MockProvider()
  let text = ''
  for await (const ev of provider.stream(
    req('ping'),
    new AbortController().signal,
  )) {
    if (ev.type === 'text_delta') text += ev.text
  }
  expect(text).toBe('Hola, soy el mock. Has dicho: ping')
})
