// Todo lo que pasa dentro del agente sale como un evento. La TUI, el modo headless,
// las sesiones y los tests solo escuchan eventos: ninguno conoce el loop por dentro
import type { PermissionRequest } from './permissions'
import type { StopReason } from './provider'
import type { QuestionRequest } from './questions'
import type { Task } from './tasks'
import type { Message, Usage } from './types'
import type { FileChange } from './tools'

export type AgentEventBody =
  | { type: 'turn_start'; turn: number }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_start'; toolUseId: string; name: string; input: unknown }
  | {
      type: 'tool_end'
      toolUseId: string
      name: string
      result: string
      isError: boolean
      durationMs: number
    }
  | { type: 'message_added'; message: Message } // las sesiones persisten escuchando esto
  | { type: 'usage'; usage: Usage }
  | { type: 'turn_end'; turn: number; stopReason: StopReason }
  | { type: 'error'; error: string; retryable: boolean }
  | { type: 'done'; reason: 'completed' | 'aborted' | 'max_turns' | 'error' }
  | { type: 'permission_request'; request: PermissionRequest } // la UI llama a request.respond()
  | { type: 'question_request'; request: QuestionRequest }
  | { type: 'tasks_updated'; tasks: Task[] }
  | { type: 'notice'; level: 'info' | 'error'; text: string } // salida de los /comandos
  | { type: 'session_loaded'; messages: Message[] } // /clear, /resume: la TUI se redibuja
  | {
      type: 'compaction' // la conversación se ha resumido
      summary: string
      summaryId: string
      firstKeptId: string | null
      tokensBefore: number
    }
  | { type: 'file_changed'; change: FileChange } // write/edit: se guarda como checkpoint
  | { type: 'select_request'; request: SelectRequest } // un /comando pide elegir algo

// Elegir una opción de la lista (lo usan /resume, /rewind...)
export type SelectRequest = {
  requestId: string
  title: string
  options: { label: string; description?: string }[]
  respond(index: number | null): void // null = cancelado
}

// parentAgentId lo usan los subagentes
type EventBase = { agentId: string; parentAgentId?: string }

export type AgentEvent = EventBase & AgentEventBody
