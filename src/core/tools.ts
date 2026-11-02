// Qué es una tool, cómo se describe al modelo y cómo se ejecuta de forma segura
import { z } from 'zod'
import type { AgentEventBody } from './events'
import type { ToolSpec } from './provider'
import type { Question, QuestionAnswer } from './questions'

export type FileChange = {
  path: string
  before: string | null // null = el archivo no existía
  after: string | null // null = se ha borrado
}

export interface ToolContext {
  cwd: string
  signal: AbortSignal
  agentId: string
  recordFileChange?(change: FileChange): void
  // Preguntar al usuario (tool question). No existe si nadie puede responder
  ask?: { question(questions: Question[]): Promise<QuestionAnswer[] | null> }
  // Emitir eventos propios (tasks_updated, eventos de subagentes...)
  emit?(event: AgentEventBody): void
}

export interface Tool<I> {
  name: string
  description: string // Esto es prompt: el modelo decide en base a ello
  schema: z.ZodType<I> // -> JSON Schema para el ToolSpec
  jsonSchema?: Record<string, unknown> // Si existe, se usa en vez de convertir `schema`
  readOnly: boolean // Para permisos y para paralelizar
  permissionTarget?(input: I): string
  execute(input: I, ctx: ToolContext): Promise<string> // Lanzar = error -> tool_result con isError
}

// El registry guarda tools con inputs distintos: aquí `any` es intencionado
export type AnyTool = Tool<any>

// Helper para que TypeScript infiera `I` a partir del  schema
export function defineTool<I>(tool: Tool<I>): Tool<I> {
  return tool
}

export type ToolResult = { content: string; isError: boolean }

// Las salidas enormes se comen el contexto: se recortan
export const MAX_TOOL_OUTPUT = 30_000

export function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text
  const omitted = text.length - max
  return `${text.slice(0, max)}\n\n[...salida truncada: ${omitted} caracteres omitidos]`
}

export class ToolRegistry {
  private tools = new Map<string, AnyTool>()

  constructor(tools: AnyTool[] = []) {
    for (const tool of tools) this.register(tool)
  }

  register(tool: AnyTool): void {
    if (this.tools.has(tool.name))
      throw new Error(`Tool duplicada: ${tool.name}`)
    this.tools.set(tool.name, tool)
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name)
  }

  list(): AnyTool[] {
    return [...this.tools.values()]
  }

  // Lo que se envía al provider
  specs(): ToolSpec[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.jsonSchema ?? toJsonSchema(tool.schema),
    }))
  }

  // Subconjunto de tools (lo usan los subagentes)
  filter(predicate: (tool: AnyTool) => boolean): ToolRegistry {
    return new ToolRegistry(this.list().filter(predicate))
  }

  // Valida el input y ejecuta. Nunca lanza: los errores vuelven al modelo como texto,
  // para que pueda corregirse (el modelo se equivoca con los argumentos a menudo)
  async run(
    name: string,
    input: unknown,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool)
      return { content: `Error: la tool "${name} no existe`, isError: true }

    const parsed = tool.schema.safeParse(input)
    if (!parsed.success) {
      return {
        content: `Error: input inválido para ${name}:\n${z.prettifyError(parsed.error)}`,
        isError: true,
      }
    }

    try {
      const content = await tool.execute(parsed.data, ctx)
      return { content: truncate(content), isError: false }
    } catch (error) {
      return { content: `Error: ${errorMessage(error)}`, isError: true }
    }
  }
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // io: 'input' -> los campos con .default() no salen como obligatorios
  const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input' })
  return json
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
