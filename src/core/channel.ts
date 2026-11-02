// Cola asíncrona: un productor hace push y un consumidor la recorre con for await
// Permite que varias partes del agente (el stream, las tools en paralelo, los
// diálogos de permisos) emitan eventos a un único iterador

export class Channel<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private waiting: ((result: IteratorResult<T>) => void)[] = []
  private closed = false

  push(value: T): void {
    if (this.closed) return
    const resolve = this.waiting.shift()
    if (resolve) resolve({ value, done: false })
    else this.queue.push(value)
  }

  close(): void {
    this.closed = true
    for (const resolve of this.waiting)
      resolve({ value: undefined, done: true })
    this.waiting = []
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift()!
        continue
      }
      if (this.closed) return
      const result = await new Promise<IteratorResult<T>>((resolve) =>
        this.waiting.push(resolve),
      )
      if (result.done) return
      yield result.value
    }
  }
}
