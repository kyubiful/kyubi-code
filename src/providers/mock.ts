// Provider mock para testing y desarrollar sin red ni cuota

import type {
  ModelInfo,
  Provider,
  ProviderEvent,
  StreamRequest,
} from '../core/provider'
import { messageText } from '../core/types'

export type MockTurn = {
  thinking?: string
  text?: string
  toolCalls?: { name: string; input: unknown }[]
}

export type MockScript =
  MockTurn[] | ((req: StreamRequest, turn: number) => MockTurn)

export class MockProvider implements Provider {
  readonly id = 'mock'
  private turn = 0
  // Todas las peticiones recibidas: los tests las inspeccionan
  readonly requests: StreamRequest[] = []

  constructor(
    private script: MockScript = echoScript,
    private delayMs = 0,
  ) {}

  models(): ModelInfo[] {
    return [
      {
        id: 'mock',
        name: 'Mock',
        contextWindow: 100_000,
        maxOutputTokens: 4_000,
      },
    ]
  }

  async *stream(
    req: StreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(req))
    const turn = this.nextTurn(req)

    if (turn.thinking) {
      yield { type: 'thinking_delta', text: turn.thinking }
      yield { type: 'thinking_end' }
    }

    // El texto se emite en trozos para simular el streaming de tokens
    for (const chunk of chunks(turn.text ?? '', 4)) {
      if (this.delayMs) await Bun.sleep(this.delayMs)
      signal.throwIfAborted()
      yield { type: 'text_delta', text: chunk }
    }
    const toolCalls = turn.toolCalls ?? []
    for (const [i, call] of toolCalls.entries()) {
      yield {
        type: 'tool_use',
        id: `mock_tool_${this.turn}_${i}`,
        name: call.name,
        input: call.input,
      }
    }
    yield {
      type: 'usage',
      usage: {
        inputTokens: JSON.stringify(req.messages).length,
        outputTokens: (turn.text ?? '').length,
      },
    }
    yield {
      type: 'done',
      stopReason: toolCalls.length ? 'tool_use' : 'end_turn',
    }
  }

  private nextTurn(req: StreamRequest): MockTurn {
    const turn = this.turn++
    if (typeof this.script === 'function') return this.script(req, turn)
    return (
      this.script[turn] ?? { text: '(mock: no hay más turnos en el guion)' }
    )
  }
}

// Guion por defecto: repite lo último que dijo el usuario
function echoScript(req: StreamRequest): MockTurn {
  const last = req.messages.at(-1)
  const result = last?.content.find((block) => block.type === 'tool_result')
  if (result) return { text: `La tool devolvió: ${result.content}` }

  const text = last ? messageText(last) : ''
  if (text.startsWith('echo:')) {
    return {
      text: 'Voy a usar la tool echo.',
      toolCalls: [{ name: 'echo', input: { text: text.slice(5).trim() } }],
    }
  }
  return { text: `Hola, soy el mock. Has dicho: ${text}` }
}

function chunks(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}
