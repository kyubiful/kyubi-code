import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../core/config'
import type { AgentEvent } from '../core/events'
import { messageText, userMessage, type Message } from '../core/types'
import { Harness } from '../harness'
import { MockProvider } from '../providers/mock'
import { splitPoint } from './compaction'
import { SessionStore } from './store'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-compaction-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

// Mock que responde "RESUMEN" cuando le piden resumir y repite lo demás
const provider = () =>
  new MockProvider((req) => {
    if (req.system.includes('resume conversaciones')) return { text: 'RESUMEN' }
    const last = req.messages.at(-1)!
    return { text: `respuesta a ${messageText(last)}` }
  })

function harness(threshold: number) {
  return new Harness({
    // El mock tiene una ventana de 100k tokens: con threshold 0.001 se compacta enseguida
    config: ConfigSchema.parse({
      provider: 'mock',
      compaction: { threshold, keepLast: 2 },
    }),
    cwd: dir,
    provider: provider(),
  })
}

async function say(h: Harness, text: string): Promise<AgentEvent[]> {
  const events = await Array.fromAsync(
    h.submit(text, new AbortController().signal),
  )
  await h.flush()
  return events
}

test('splitPoint nunca separa un tool_use de su tool_result', () => {
  const messages: Message[] = [
    userMessage('a'),
    {
      id: '2',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }],
    },
    {
      id: '3',
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 't', content: '' }],
    },
    { id: '4', role: 'assistant', content: [{ type: 'text', text: 'fin' }] },
  ]
  // Los 2 últimos empezarían en un tool_result: no hay prompt del usuario después
  expect(splitPoint(messages, 2)).toBe(4)
  expect(splitPoint([...messages, userMessage('b')], 1)).toBe(4)
})

test('compacta sola al pasar el umbral y sigue la conversación', async () => {
  const h = harness(0.001)
  await say(h, 'uno')
  await say(h, 'dos')
  const events = await say(h, 'tres')
  expect(events.some((e) => e.type === 'compaction')).toBe(true)
  const texts = h.agent.messages.map(messageText)
  expect(texts[0]).toContain('RESUMEN')
  expect(texts.at(-1)).toBe('respuesta a tres')

  // Al recargar la sesión se obtiene lo mismo
  const reloaded = await SessionStore.open(h.session.path)
  expect(reloaded.messages().map(messageText)).toEqual(texts)
})

test('sin pasar el umbral no compacta', async () => {
  const h = harness(0.99)
  await say(h, 'uno')
  const events = await say(h, 'dos')
  expect(events.some((e) => e.type === 'compaction')).toBe(false)
})

test('/compact manual y rewind a antes de la compaction', async () => {
  const h = harness(0.99)
  await say(h, 'uno')
  await say(h, 'dos')
  await say(h, '/compact céntrate en los números')
  expect(messageText(h.agent.messages[0]!)).toContain('RESUMEN')

  // El historial completo sigue en el archivo: volver a "dos" lo recupera
  const dos = h.session
    .all()
    .find((e) => e.type === 'message' && messageText(e.message) === 'dos')!
  await h.rewind(dos.id, 'conversation')
  expect(h.agent.messages.map(messageText)).toEqual(['uno', 'respuesta a uno'])
})
