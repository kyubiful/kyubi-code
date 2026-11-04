// Compactaction: cuando la conversación se acerca al límite de contexto, el propio modelo
// la resume y se sigue con el resumen + los últimos mensajes. El historial completo
// sigue en el JSONL, así que el rewind a un punto anterior sigue funcionando
import type { Provider } from '../core/provider'
import { userMessage, type Message } from '../core/types'

export type CompactionOptions = {
  threshold: number // 0.8 = al 80% de la ventana
  keepLast: number // mensajes recientes que se conservan tal cual
  instructions?: string // de /compact <instrucciones>
}

const SUMMARY_PROMPT = `Resume la conversación anterior para poder continuarla sin ella. Incluye:
1. El objetivo del usuario y sus peticiones (con sus palabras cuando importe).
2. Decisiones tomadas y por qué.
3. Archivos leídos o modificados, con lo relevante de cada uno.
4. Errores encontrados y cómo se resolvieron.
5. Qué queda pendiente y cuál era el siguiente paso.
Sé concreto: rutas, nombres de funciones, comandos. No añadas nada que no esté en la conversación.`

// Dónde cortar: se conservan los últimos `keepLast` mensajes, pero empezando
// siempre en un mensaje escrito por el usuario. Así nunca se separa un tool_use
// de su tool_result. Devuelve el índice del primer mensaje conservado
export function splitPoint(messages: Message[], keepLast: number): number {
  for (
    let i = Math.max(0, messages.length - keepLast);
    i < messages.length;
    i++
  ) {
    if (isUserPrompt(messages[i]!)) return i
  }
  return messages.length // no hay un buen punto: se resume todo
}

function isUserPrompt(message: Message): boolean {
  return (
    message.role === 'user' &&
    message.content.some((b) => b.type === 'text') &&
    !message.content.some((b) => b.type === 'tool_result')
  )
}

export async function summarize(
  provider: Provider,
  model: string,
  messages: Message[],
  signal: AbortSignal,
  instructions?: string,
): Promise<string> {
  const request = instructions
    ? `${SUMMARY_PROMPT}\n\nAdemás: ${instructions}`
    : SUMMARY_PROMPT
  let summary = ''
  const stream = provider.stream(
    {
      model,
      system: 'Eres un asistente que resume conversaciones de programación',
      messages: [...messages, userMessage(request)],
      tools: [],
    },
    signal,
  )
  for await (const event of stream) {
    if (event.type === 'text_delta') summary += event.text
  }
  if (!summary.trim()) throw new Error('El modelo no devolvió ningún resumen')
  return summary.trim()
}

// El resumen entra en la conversación como un par usuario/asistente.
// Los ids derivan de `summaryId` para que sean siempre los mismos al recargar
export function summaryMessages(summary: string, summaryId: string): Message[] {
  return [
    {
      id: `${summaryId}-summary`,
      role: 'user',
      content: [
        {
          type: 'text',
          text: `<resumen>\nLa conversación anterior se ha compactado. Este es su resumen:\n\n${summary}\n</resumen>`,
        },
      ],
    },
    {
      id: `${summaryId}-ack`,
      role: 'assistant',
      content: [
        { type: 'text', text: 'Entendido. Continúo a partir del resumen.' },
      ],
    },
  ]
}
