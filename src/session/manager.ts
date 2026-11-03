// Operaciones sobre las sesiones guardadas: listar, borrar, limpiar, exportar y titular
import { rm } from 'node:fs/promises'
import type { Provider } from '../core/provider'
import { messageText, newId, userMessage } from '../core/types'
import { listSessionFiles, SessionStore } from './store'

export type SessionMeta = {
  id: string
  title: string
  cwd: string
  model?: string
  createdAt: string
  updatedAt: string
  messageCount: number
  parentSessionId?: string // fork o subagente
}

// SessionMeta se CALCULA leyendo el JSONL: no es otra fuente de verdad que mantener.
// Si con cientos de sesiones el listado va lento, se podría cachear en un index.json
export async function listSessions(cwd: string): Promise<SessionMeta[]> {
  const files = await listSessionFiles(cwd)
  const metas = await Promise.all(
    files.map(async (file) => {
      try {
        const store = await SessionStore.open(file.path)
        const messages = store.messages()
        const usage = store.all().findLast((e) => e.type === 'usage')
        return {
          id: store.id,
          title:
            store.title ?? preview(messages[0] ? messageText(messages[0]) : ''),
          cwd: store.header.cwd,
          model: usage?.type === 'usage' ? usage.model : undefined,
          createdAt: store.header.createdAt,
          updatedAt: file.mtime.toISOString(),
          messageCount: messages.length,
          parentSessionId: store.header.parentSessionId,
        } satisfies SessionMeta
      } catch {
        return null // archivo corrupto: no se lista
      }
    }),
  )
  return metas.filter((meta) => meta !== null)
}

export async function deleteSession(
  cwd: string,
  idOrPrefix: string,
): Promise<string> {
  const store = await SessionStore.find(cwd, idOrPrefix)
  await rm(store.path, { force: true })
  return store.id
}

// Borra las sesiones que llevan más de `days` días sin tocarse (0 = nunca)
export async function cleanupSessions(
  cwd: string,
  days: number,
): Promise<number> {
  if (days <= 0) return 0
  const limit = Date.now() - days * 24 * 3_600_000
  const old = (await listSessionFiles(cwd)).filter(
    (file) => file.mtime.getTime() < limit,
  )
  await Promise.all(old.map((file) => rm(file.path, { force: true })))
  return old.length
}

// Markdown legible de la rama activa
export function exportMarkdown(store: SessionStore): string {
  const lines = [`# ${store.title ?? 'Sesión'} (${store.id})`, '']
  for (const message of store.messages()) {
    for (const block of message.content) {
      if (block.type === 'text') {
        lines.push(
          message.role === 'user'
            ? `## Usuario\n\n${block.text}`
            : `## Asistente\n\b${block.text}`,
          '',
        )
      } else if (block.type === 'tool_use') {
        lines.push(
          `> 🔧 **${block.name}** \`${JSON.stringify(block.input)}\``,
          '',
        )
      } else if (block.type === 'tool_result') {
        const content =
          block.content.length > 2_000
            ? `${block.content.slice(0, 2_000)}\n...`
            : block.content
        lines.push('```', content, '```', '')
      }
    }
  }
  return lines.join('\n')
}

// Pide al modelo un título corto. Es una llamada barata: sin tools ni historial.
export async function generateTitle(
  provider: Provider,
  model: string,
  firstMessage: string,
): Promise<string> {
  let title = ''
  // El mock tiene un guion fijo: si le pidiéramos el título, gastaríamos un turno del guion
  if (provider.id === 'mock') return preview(firstMessage)
  try {
    const stream = provider.stream(
      {
        model,
        system:
          'Genera un título de 3 a 6 palabras para una conversación que empieza con el mensaje del usuario. Responde solo con el título, sin comillas ni punto final.',
        messages: [userMessage(firstMessage.slice(0, 2_000))],
        tools: [],
        sessionId: newId(),
      },
      AbortSignal.timeout(30_000),
    )
    for await (const event of stream) {
      if (event.type === 'text_delta') title += event.text
    }
  } catch {
    // Sin título del modelo: se usa el comienzo del mensaje
  }
  return preview(title.trim().split('\n')[0] || firstMessage)
}

function preview(text: string): string {
  const line = text.replaceAll('\n', '').trim()
  return line.length > 60 ? `${line.slice(0, 59)}...` : line || '(vacía)'
}
