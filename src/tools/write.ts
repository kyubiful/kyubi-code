import { z } from 'zod'
import { defineTool, type ToolContext } from '../core/tools'
import { applyFileChange, displayPath, resolvePath } from './fs'

export const writeTool = defineTool({
  name: 'write',
  description: `Crea un archivo o lo sobrescribe entero. Crea los directorios que falten.
- Para cambiar parte de un archivo existente usa edit, no write.`,
  schema: z.object({
    path: z.string().describe('Ruta del archivo'),
    content: z.string().describe('Contenido completo del archivo'),
  }),
  readOnly: false,
  permissionTarget: (input) => input.path,
  execute: async (params, ctx) => executeWrite(params, ctx),
})

async function executeWrite(
  { path, content }: { path: string; content: string },
  ctx: ToolContext,
): Promise<string> {
  const abs = resolvePath(path, ctx)
  const change = await applyFileChange(abs, content, ctx)
  const verb = change.before === null ? 'Creado' : 'Sobrescrito'
  return `${verb}: ${displayPath(abs, ctx.cwd)} (${content.split('\n').length} líneas)`
}
