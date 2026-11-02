import { expect, test } from 'bun:test'
import type { ProviderEvent } from '../../core/provider.ts'
import type { Message } from '../../core/types.ts'
import { parseSSE } from '../sse.ts'
import { ResponsesStreamMapper, toResponsesInput } from './convert.ts'

test('convierte una conversación con tools al input de la Responses API', () => {
  const messages: Message[] = [
    {
      id: '1',
      role: 'user',
      content: [{ type: 'text', text: 'lee package.json' }],
    },
    {
      id: '2',
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          text: 'pienso',
          providerData: {
            provider: 'openai',
            data: { type: 'reasoning', summary: [], encrypted_content: 'x' },
          },
        },
        {
          type: 'thinking',
          text: 'de otro provider',
          providerData: { provider: 'otro', data: 1 },
        },
        { type: 'text', text: 'voy' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'read',
          input: { path: 'package.json' },
        },
      ],
    },
    {
      id: '3',
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'call_1', content: '{}' }],
    },
  ]
  expect(toResponsesInput(messages)).toEqual([
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'lee package.json' }],
    },
    { type: 'reasoning', summary: [], encrypted_content: 'x' },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'voy' }],
    },
    {
      type: 'function_call',
      call_id: 'call_1',
      name: 'read',
      arguments: '{"path":"package.json"}',
    },
    { type: 'function_call_output', call_id: 'call_1', output: '{}' },
  ])
})

test('traduce un stream real grabado a ProviderEvents', async () => {
  const file = Bun.file(new URL('./fixtures/tool-call.sse', import.meta.url))
  const mapper = new ResponsesStreamMapper()
  const events: ProviderEvent[] = []
  for await (const sse of parseSSE(file.stream())) {
    events.push(...mapper.map(JSON.parse(sse.data)))
  }
  expect(events).toEqual([
    { type: 'thinking_delta', text: 'Necesito leer ' },
    { type: 'thinking_delta', text: 'el archivo.' },
    {
      type: 'thinking_end',
      providerData: {
        provider: 'openai',
        data: {
          type: 'reasoning',
          summary: [
            { type: 'summary_text', text: 'Necesito leer el archivo.' },
          ],
          encrypted_content: 'gAAAA-cifrado',
        },
      },
    },
    { type: 'text_delta', text: 'Voy a ' },
    { type: 'text_delta', text: 'leerlo.' },
    {
      type: 'tool_use',
      id: 'call_abc',
      name: 'read',
      input: { path: 'package.json' },
    },
    {
      type: 'usage',
      usage: { inputTokens: 1200, outputTokens: 45, cachedTokens: 1024 },
    },
    { type: 'done', stopReason: 'tool_use' },
  ])
})

test('un evento de error del stream lanza una excepción', () => {
  const mapper = new ResponsesStreamMapper()
  expect(() => mapper.map({ type: 'error', message: 'boom' } as never)).toThrow(
    'boom',
  )
})
