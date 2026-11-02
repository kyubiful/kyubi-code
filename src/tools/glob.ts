import { z } from 'zod'
import { defineTool, type ToolContext } from '../core/tools'
import { listFiles, resolvePath } from './fs'

const MAX_RESULTS = 500

export const globTool = defineTool({
  name: 'glob',
  description: `Buscar archivos por patrón glob (por ejemplo "src/**/*.ts" o "**/package.json").
Respeta .gitignore. Devuelve rutas relativas al directorio de búsqueda.`,
  schema: z.object({
    pattern: z.string().describe('Patrón glob'),
    path: z
      .string()
      .optional()
      .describe('Directorio donde buscar (por defecto, el de trabajo)'),
  }),
  readOnly: true,
  permissionTarget: (input) => input.path ?? '.',
  execute: async (input, ctx) => await executeGlob(input, ctx),
})

async function executeGlob(
  { pattern, path }: { pattern: string; path?: string },
  ctx: ToolContext,
): Promise<string> {
  const dir = resolvePath(path ?? '.', ctx)
  const glob = new Bun.Glob(pattern)
  const matches = (await listFiles(dir)).filter((file) => glob.match(file))
  if (!matches.length) return 'No se encontraron archivos'
  const shown = matches.slice(0, MAX_RESULTS).join('\n')
  const extra = matches.length - MAX_RESULTS
  return extra > 0
    ? `${shown}\n\n[${extra} resultados más: afina el patrón]`
    : shown
}
