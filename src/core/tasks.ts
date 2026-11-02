// Lista de tareas del agente. Vive en el harness (una por sesión) y la modifican
// las tools task_create / task_update.
export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string // corto y legible ("1", "2"...): el modelo lo tiene que repetir
  subject: string
  description?: string
  status: TaskStatus
  blockedBy?: string[] // ids de otras tareas
  owner?: string // agentId (lo usan los subagentes, paso 23)
}

export class TaskStore {
  tasks: Task[] = []

  constructor(tasks: Task[] = []) {
    this.tasks = tasks
  }

  create(input: {
    subject: string
    description?: string
    blockedBy?: string[]
  }): Task {
    for (const id of input.blockedBy ?? []) this.get(id)
    const nextId = Math.max(0, ...this.tasks.map((task) => Number(task.id))) + 1
    const task: Task = { id: String(nextId), status: 'pending', ...input }
    this.tasks.push(task)
    return task
  }

  update(id: string, patch: Partial<Omit<Task, 'id'>>): Task {
    const task = this.get(id)
    const next = { ...task, ...patch }
    if (next.status !== 'pending') {
      const blockers = (next.blockedBy ?? []).filter(
        (blocker) => this.get(blocker).status !== 'completed',
      )
      if (blockers.length) {
        throw new Error(
          `La tarea ${id} está bloqueada por: ${blockers.join(', ')}`,
        )
      }
    }
    if (next.status === 'in_progress') {
      const other = this.tasks.find(
        (t) =>
          t.id !== id && t.status === 'in_progress' && t.owner === next.owner,
      )
      if (other) {
        throw new Error(
          `La tarea ${other.id} ya está en curso. Complétala antes de empezar otra.`,
        )
      }
    }
    Object.assign(task, patch)
    return task
  }

  get(id: string): Task {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) throw new Error(`No existe la tarea ${id}`)
    return task
  }

  open(): Task[] {
    return this.tasks.filter((task) => task.status !== 'completed')
  }

  format(): string {
    if (!this.tasks.length) return 'No hay tareas'
    const icon = { pending: '[ ]', in_progress: '[~]', completed: '[x]' }
    return this.tasks
      .map((task) => {
        const blocked = task.blockedBy?.length
          ? ` (bloqueada por ${task.blockedBy.join(', ')})`
          : ''
        return `${icon[task.status]} ${task.id}. ${task.subject}${blocked}`
      })
      .join('\n')
  }

  // Recordatorio que se añade a cada petición mientras haya tareas abiertas
  reminder(): string | undefined {
    if (!this.open().length) return undefined
    return `<recordatorio>\nTareas actuales:\n${this.format()}\nMantén la lista al día con task_update.\n</recordatorio>`
  }
}
