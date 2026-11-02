// Tools para que el modelo gestione su lista de tareas
import { z } from 'zod'
import type { TaskStore } from '../core/tasks.ts'
import { defineTool, type AnyTool, type ToolContext } from '../core/tools.ts'

export function taskTools(store: TaskStore): AnyTool[] {
  // Cada cambio se notifica a la UI y a la sesión
  const changed = (ctx: ToolContext) => {
    ctx.emit?.({ type: 'tasks_updated', tasks: structuredClone(store.tasks) })
    return store.format()
  }

  const taskCreate = defineTool({
    name: 'task_create',
    description: `Crea una tarea en tu lista. Úsalo para planificar trabajo de 3 o más pasos
antes de empezar, o cuando el usuario pide varias cosas a la vez. No lo uses para tareas triviales.`,
    schema: z.object({
      subject: z
        .string()
        .describe('Qué hay que hacer, en imperativo ("Añadir tests de X")'),
      description: z.string().optional(),
      blockedBy: z
        .array(z.string())
        .optional()
        .describe('Ids de tareas que deben terminar antes'),
    }),
    readOnly: true, // no toca el sistema: no necesita permiso
    execute: async (input, ctx) =>
      await executeTaskCreate(input, ctx, store, changed),
  })

  const taskUpdate = defineTool({
    name: 'task_update',
    description: `Actualiza una tarea. Márcala in_progress al empezarla (solo una a la vez)
y completed en cuanto la termines, no al final de todo.`,
    schema: z.object({
      id: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed']).optional(),
      subject: z.string().optional(),
      description: z.string().optional(),
    }),
    readOnly: true,
    execute: async (input, ctx) =>
      executeTaskUpdate(input, ctx, store, changed),
  })

  const taskList = defineTool({
    name: 'task_list',
    description: 'Muestra la lista de tareas con su estado.',
    schema: z.object({}),
    readOnly: true,
    execute: async () => await executeTaskList(store),
  })

  return [taskCreate, taskUpdate, taskList]
}

async function executeTaskCreate(
  input: { subject: string; description?: string; blockedBy?: string[] },
  ctx: ToolContext,
  store: TaskStore,
  changed: (ctx: ToolContext) => string,
): Promise<string> {
  const task = store.create(input)
  return `Tarea ${task.id} creada.\n\n${changed(ctx)}`
}

async function executeTaskUpdate(
  {
    id,
    ...patch
  }: {
    id: string
    status?: 'pending' | 'in_progress' | 'completed'
    subject?: string
    description?: string
  },
  ctx: ToolContext,
  store: TaskStore,
  changed: (ctx: ToolContext) => string,
) {
  // El dueño de la tarea es el agente que la empieza
  const owner = patch.status === 'in_progress' ? ctx.agentId : undefined
  store.update(id, owner ? { ...patch, owner } : patch)
  return changed(ctx)
}

async function executeTaskList(store: TaskStore): Promise<string> {
  return store.format()
}
