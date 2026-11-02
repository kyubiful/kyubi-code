// Traducción entre el formato interno y la Responses API de OpenAI.
// Los tipos de la API viven solo aquí: el resto del harness no los conoce
import type { ProviderEvent, StopReason, ToolSpec } from '../../core/provider'
import type { Message } from '../../core/types'

export const PROVIDER_DATA_KEY = 'openai'

// Tipos (simplificados) de la Responses API

type ReasoningItem = {
  type: 'reasoning'
  summary: { type: 'summary_text'; text: string }[]
  encrypted_content?: string | null
}

export type ResponseInputItem =
  | {
      type: 'message'
      role: 'user'
      content: { type: 'input_text'; text: string }[]
    }
  | {
      type: 'message'
      role: 'assistant'
      content: { type: 'output_text'; text: string }[]
    }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | ReasoningItem

type OutputItem =
  | (ReasoningItem & { id: string })
  | {
      type: 'function_call'
      id: string
      call_id: string
      name: string
      arguments: string
    }
  | { type: 'message'; id: string }

// Los eventos del stream tienen todos un `type`. Solo tipamos los que usamos;
// en el mapper se hace un cast según el `type`.
export type ResponsesStreamEvent = { type: string }

type DeltaEvent = { type: string; delta: string }
type ItemDoneEvent = { type: 'response.output_item.done'; item: OutputItem }
type CompletedEvent = {
  type: 'response.completed' | 'response.incomplete'
  response: {
    usage?: {
      input_tokens: number
      output_tokens: number
      input_tokens_details?: { cached_tokens?: number }
    }
    incomplete_details?: { reason?: string } | null
  }
}
type FailedEvent = {
  type: 'response.failed'
  response: { error?: { message?: string } }
}
type ErrorEvent = { type: 'error'; message?: string; code?: string }

// --- Mensajes internos → input de la API -------------------------------------------

export function toResponsesInput(messages: Message[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = []
  for (const message of messages) {
    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          if (message.role === 'user') {
            input.push({
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: block.text }],
            })
          } else {
            input.push({
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: block.text }],
            })
          }
          break
        case 'thinking':
          // Solo se reenvía el razonamiento que generó este mismo provider
          if (block.providerData?.provider === PROVIDER_DATA_KEY) {
            input.push(block.providerData.data as ReasoningItem)
          }
          break
        case 'tool_use':
          input.push({
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          })
          break
        case 'tool_result':
          input.push({
            type: 'function_call_output',
            call_id: block.toolUseId,
            output: block.content,
          })
          break
      }
    }
  }
  return input
}

export function toResponsesTools(tools: ToolSpec[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }))
}

// --- Eventos de la API → ProviderEvent ---------------------------------------------

// Tiene estado: recuerda si hubo tool calls para decidir el stopReason al final
export class ResponsesStreamMapper {
  private sawToolCall = false

  map(event: ResponsesStreamEvent): ProviderEvent[] {
    switch (event.type) {
      case 'response.output_text.delta':
        return [{ type: 'text_delta', text: (event as DeltaEvent).delta }]

      case 'response.reasoning_summary_text.delta':
        return [{ type: 'thinking_delta', text: (event as DeltaEvent).delta }]

      case 'response.reasoning_summary_part.done':
        // Separa los párrafos del resumen de razonamiento
        return [{ type: 'thinking_delta', text: '\n\n' }]

      case 'response.output_item.done': {
        const { item } = event as ItemDoneEvent
        if (item.type === 'function_call') {
          this.sawToolCall = true
          const input = parseArguments(item.arguments)
          return [
            { type: 'tool_use', id: item.call_id, name: item.name, input },
          ]
        }
        if (item.type === 'reasoning') {
          // Se guarda el item entero, sin id (con store=false no se puede referenciar)
          const { id: _, ...reasoning } = item
          return [
            {
              type: 'thinking_end',
              providerData: { provider: PROVIDER_DATA_KEY, data: reasoning },
            },
          ]
        }
        return []
      }

      case 'response.completed':
      case 'response.incomplete': {
        const { response } = event as CompletedEvent
        const events: ProviderEvent[] = []
        if (response.usage) {
          events.push({
            type: 'usage',
            usage: {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
              cachedTokens:
                response.usage.input_tokens_details?.cached_tokens ?? 0,
            },
          })
        }
        let stopReason: StopReason = this.sawToolCall ? 'tool_use' : 'end_turn'
        if (response.incomplete_details?.reason === 'max_output_tokens') {
          stopReason = 'max_tokens'
        }
        events.push({ type: 'done', stopReason })
        return events
      }

      case 'response.failed': {
        const { response } = event as FailedEvent
        throw new Error(
          response.error?.message ?? 'La respuesta de OpenAI ha fallado',
        )
      }

      case 'error': {
        const error = event as ErrorEvent
        throw new Error(
          error.message ?? error.code ?? 'Error en el stream de OpenAI',
        )
      }

      default:
        return [] // el resto de eventos no nos interesan
    }
  }
}

// Si el modelo genera JSON inválido, se pasa el string tal cual: la validación
// de la tool devolverá un error legible y el modelo podrá corregirse
function parseArguments(args: string): unknown {
  try {
    return JSON.parse(args || '{}')
  } catch {
    return args
  }
}
