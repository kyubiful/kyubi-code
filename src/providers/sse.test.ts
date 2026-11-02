import { expect, test } from 'bun:test'
import { parseSSE } from './sse.ts'

// Crea un stream que entrega el texto en los trozos indicados
function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

test('parsea eventos con nombre y datos', async () => {
  const events = await Array.fromAsync(
    parseSSE(streamOf('event: a\ndata: {"x":1}\n\nevent: b\ndata: 2\n\n')),
  )
  expect(events).toEqual([
    { event: 'a', data: '{"x":1}' },
    { event: 'b', data: '2' },
  ])
})

test('soporta eventos partidos entre chunks y \\r\\n', async () => {
  const events = await Array.fromAsync(
    parseSSE(streamOf('data: hol', 'a\r\n', '\r\ndata: adi', 'os\n\n')),
  )
  expect(events).toEqual([{ data: 'hola' }, { data: 'adios' }])
})

test('ignora comentarios y une varias líneas de data', async () => {
  const events = await Array.fromAsync(
    parseSSE(streamOf(': keep-alive\n\ndata: a\ndata: b\n\n')),
  )
  expect(events).toEqual([{ data: 'a\nb' }])
})

test('devuelve el último evento aunque no termine en línea en blanco', async () => {
  const events = await Array.fromAsync(parseSSE(streamOf('data: fin')))
  expect(events).toEqual([{ data: 'fin' }])
})
