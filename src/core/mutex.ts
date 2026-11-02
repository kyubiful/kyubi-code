// Garantiza que solo una tarea a la vez ejecuta una sección. Lo usamos para que
// nunca haya dos diálogos (permisos, preguntas) abiertos al mismo tiemop, aunque
// varias tools se ejecuten en paralelo.
export class Mutex {
  private last: Promise<unknown> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    // Cada tarea espera a que termine la anterior (haya ido bien o mal)
    const result = this.last.then(task, task)
    this.last = result.catch(() => {})
    return result
  }
}
