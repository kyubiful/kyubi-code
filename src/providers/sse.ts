// Parser de Server-Sent Events. Formato:
//  event: nombre       (optional)
//  data: {...}         (una o varias líneas)
//  <línea en blanco>   -> fin del evento
// Las líneas que empiezan por ":" son comentarios (keep-alive)
export type SSEEvent = { event?: string; data: string }

export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<SSEEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    // Un evento puede llegar partido entre varios chunks: se acumula en buffer
    buffer += decoder.decode(chunk, { stream: true })
    buffer = buffer.replaceAll('\r\n', '\n')
    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const event = parseEvent(buffer.slice(0, end))
      buffer = buffer.slice(end + 2)
      if (event) yield event
    }
  }
  const last = parseEvent(buffer + decoder.decode())
  if (last) yield last
}

function parseEvent(raw: string): SSEEvent | null {
  let event: string | undefined
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    // El espacio tras ":" es opcional y no forma parte del valor
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return data.length ? { event, data: data.join('\n') } : null
}
