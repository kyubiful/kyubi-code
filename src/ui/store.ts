// Estado de la TUI derivado de los eventos del agente
// `reduce` es una función pura: (items, evento) -> items nuevos. Así se puede
// testear sin pintar nada, y la TUI solo tiene que dibujar `items`.
import type { AgentEvent } from '../core/events'
import { newId } from '../core/types'

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool'
      id: string // = toolUseId
      name: string
      input: unknown
      status: 'running' | 'done' | 'error'
      result?: string
      agentId: string
    }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string }

export function reduce(items: ChatItem[], event: AgentEvent): ChatItem[] {
  switch (event.type) {
    case 'message_added': {
      if (event.message.role !== 'user') return items
      // Los mensajes del usuario (incluidos los que estaban en cola)
      const texts = event.message.content.filter(
        (block) => block.type === 'text',
      )
      return [
        ...items,
        ...texts.map((block): ChatItem => ({
          kind: 'user',
          id: newId(),
          text: block.text,
        })),
      ]
    }
    case 'text_delta': {
      const last = items.at(-1)
      if (last?.kind === 'assistant' && last.streaming) {
        return replaceLast(items, { ...last, text: last.text + event.text })
      }
      return [
        ...items,
        { kind: 'assistant', id: newId(), text: event.text, streaming: true },
      ]
    }
    case 'thinking_delta': {
      const last = items.at(-1)
      if (last?.kind === 'thinking') {
        return replaceLast(items, { ...last, text: last.text + event.text })
      }
      return [...items, { kind: 'thinking', id: newId(), text: event.text }]
    }
    case 'tool_start':
      return [
        ...items,
        {
          kind: 'tool',
          id: event.toolUseId,
          name: event.name,
          input: event.input,
          status: 'running',
          agentId: event.agentId,
        },
      ]
    case 'tool_end':
      return items.map((item) =>
        item.kind === 'tool' && item.id === event.toolUseId
          ? {
              ...item,
              status: event.isError ? 'error' : 'done',
              result: event.result,
            }
          : item,
      )
    case 'turn_end':
      return items.map((item) =>
        item.kind === 'assistant' && item.streaming
          ? { ...item, streaming: false }
          : item,
      )
    case 'error':
      return [
        ...items,
        {
          kind: 'notice',
          id: newId(),
          level: event.retryable ? 'info' : 'error',
          text: event.retryable ? `Reintentando: ${event.error}` : event.error,
        },
      ]
    case 'notice':
      return [...items, notice(event.text, event.level)]
    case 'cleared':
      return []
    case 'done':
      if (event.reason === 'aborted') return [...items, notice('Cancelado')]
      if (event.reason === 'max_turns') {
        return [
          ...items,
          notice(
            'Se alcanzó el máximo de turnos. Escribe "continúa" para seguir.',
          ),
        ]
      }
      return items
    default:
      return items
  }
}

export function notice(
  text: string,
  level: 'info' | 'error' = 'info',
): ChatItem {
  return { kind: 'notice', id: newId(), level, text }
}

function replaceLast(items: ChatItem[], item: ChatItem): ChatItem[] {
  return [...items.slice(0, -1), item]
}

// Resumen de una línea del input de una tool, para mostrarlo junto a su nombre
export function summarizeInput(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const pick =
    name === 'bash'
      ? i.command
      : (i.path ?? i.pattern ?? i.url ?? i.query ?? i.subject ?? i.prompt)
  const text = typeof pick === 'string' ? pick : JSON.stringify(input)
  const oneLine = text.replaceAll('\n', ' ')
  return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine
}
