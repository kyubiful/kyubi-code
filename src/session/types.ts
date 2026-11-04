import type { Task } from '../core/tasks'
import type { FileChange } from '../core/tools'
import type { Message, Usage } from '../core/types'

// Primera línea del archivo. `version` permite migrar el formato en el futuro
export type SessionHeader = {
  type: 'session'
  version: 1
  sessionId: string
  cwd: string
  createdAt: string
  parentSessionId?: string // fork o subagente
}

// Cada línea siguiente es una entrada. `parentId` apunta a la entrada anterior,
// así que el archivo forma un árbol: la rama activa se obtiene siguiendo
// parentId desde la última entrada (eso permite el rewind y el fork)
type EntryBase = { id: string; parentId: string | null; timestamp: string }

export type SessionEntryBody =
  | { type: 'message'; message: Message } // id de la entrada = message.id
  | { type: 'usage'; usage: Usage; model: string }
  | { type: 'tasks'; tasks: Task[] }
  | {
      type: 'compaction'
      summary: string
      summaryId: string
      firstKeptId: string | null
    }
  | { type: 'compaction'; summary: string; firstKeptId: string } //
  | { type: 'checkpoint'; messageId: string; changes: FileChange[] } //
  | { type: 'rewind' }
  | {
      type: 'meta'
      key: 'title' | 'provider_session' | (string & {})
      value: unknown
    }

export type SessionEntry = EntryBase & SessionEntryBody
