// Contrato entre el agent loop y cualquier modelo. Cada provider traduce su API
// a estos tipos. El loop nunca ve el formato concreto de OpenAI, Anthropic, etc
import type { Message, ProviderData, Usage } from './types'

export type ModelInfo = {
  id: string // id que espera la API
  name: string // para mostrar en la UI
  contextWindow: number // Contexto total del modelo
  maxOutputTokens: number
  supportsThinking?: boolean
}

// Lo que el provider recibe de cada tool: el schema ya convertido a JSON
export type ToolSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'aborted'

export type StreamRequest = {
  model: string
  system: string
  messages: Message[]
  tools: ToolSpec[]
  maxOutputTokens?: number
  sessionId?: string // Se usa para la caché
}

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end'; providerData?: ProviderData } // Cierra el bloque thinking
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; stopReason: StopReason }

export interface Provider {
  id: string
  models(): ModelInfo[]
  stream(req: StreamRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
}

// Errores normalizados: el loop decide si reintentar sin conocer el provider
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      'auth' | 'rate_limit' | 'overloaded' | 'bad_request' | 'network',
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// Busca un modelo por id. Si no existe, devuelve uno genérico para no romper
export function findModel(provider: Provider, id: string): ModelInfo {
  return (
    provider.models().find((model) => model.id === id) ?? {
      id,
      name: id,
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
    }
  )
}
