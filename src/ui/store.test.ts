import { expect, test } from 'bun:test'
import type { AgentEvent, AgentEventBody } from '../core/events.ts'
import { reduce, summarizeInput, type ChatItem } from './store.ts'

const ev = (body: AgentEventBody): AgentEvent => ({ ...body, agentId: 'main' })
const apply = (events: AgentEventBody[]) =>
  events.map(ev).reduce(reduce, [] as ChatItem[])

test('el texto en streaming se acumula en un solo item', () => {
  const items = apply([
    {
      type: 'message_added',
      message: {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: 'hola' }],
      },
    },
    { type: 'text_delta', text: 'Ho' },
    { type: 'text_delta', text: 'la' },
    { type: 'turn_end', turn: 1, stopReason: 'end_turn' },
  ])
  expect(items).toMatchObject([
    { kind: 'user', text: 'hola' },
    { kind: 'assistant', text: 'Hola', streaming: false },
  ])
})

test('las tools pasan de running a done/error', () => {
  const items = apply([
    { type: 'tool_start', toolUseId: 't1', name: 'read', input: { path: 'a' } },
    {
      type: 'tool_start',
      toolUseId: 't2',
      name: 'bash',
      input: { command: 'x' },
    },
    {
      type: 'tool_end',
      toolUseId: 't2',
      name: 'bash',
      result: 'mal',
      isError: true,
      durationMs: 1,
    },
    {
      type: 'tool_end',
      toolUseId: 't1',
      name: 'read',
      result: 'ok',
      isError: false,
      durationMs: 1,
    },
  ])
  expect(items).toMatchObject([
    { kind: 'tool', id: 't1', status: 'done', result: 'ok' },
    { kind: 'tool', id: 't2', status: 'error', result: 'mal' },
  ])
})

test('el texto después de una tool empieza un item nuevo', () => {
  const items = apply([
    { type: 'text_delta', text: 'antes' },
    { type: 'tool_start', toolUseId: 't1', name: 'read', input: {} },
    { type: 'text_delta', text: 'después' },
  ])
  expect(items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant'])
})

test('cancelar añade un aviso', () => {
  expect(apply([{ type: 'done', reason: 'aborted' }])).toMatchObject([
    { kind: 'notice', text: 'Cancelado' },
  ])
})

test('summarizeInput', () => {
  expect(summarizeInput('bash', { command: 'ls -la' })).toBe('ls -la')
  expect(summarizeInput('read', { path: 'src/a.ts' })).toBe('src/a.ts')
  expect(summarizeInput('otra', { a: 1 })).toBe('{"a":1}')
})
