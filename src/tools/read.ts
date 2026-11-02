import { z } from 'zod'
import { stat } from 'node:fs/promises'
import { defineTool, type ToolContext } from '../core/tools'
import { displayPath, resolvePath } from './fs'

const MAX_BYTES = 2_000_000

export const readTool = defineTool({
  name: 'read',
  description: `Lee un archivo de texto y lo devuelve con números de línea (formato "N\\tlínea").
- Para archivos grandes usa offset y limit para leer por partes.
- Lee siempre un archivo antes de editarlo.
- Para buscar archivos usa glob. Para buscar contenido, grep.`,
  schema: z.object({
    path: z
      .string()
      .describe(
        'Ruta del archivo (relativa al directorio de trabajo o absoluta',
      ),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Primera línea a leer (empieza en 1)'),
    limit: z
      .number()
      .int()
      .min(1)
      .default(2_000)
      .describe('Número máximo de líneas'),
  }),
  readOnly: true,
  permissionTarget: (input) => input.path,
  execute: async (params, ctx) => await executeRead(params, ctx),
})

async function executeRead(
  { path, offset = 1, limit }: { path: string; offset?: number; limit: number },
  ctx: ToolContext,
) {
  const abs = resolvePath(path, ctx)
  const info = await stat(abs).catch(() => null)
  if (!info) throw new Error(`No existe: ${path}`)
  if (info.isDirectory())
    throw new Error(`${path} es un directorio. Usa glob para listarlo.`)
  if (info.size > MAX_BYTES) {
    throw new Error(
      `${path} ocupa ${info.size} bytes. Usa offset/limit o grep.`,
    )
  }
  const text = await Bun.file(abs).text()
  if (text.includes('\0')) throw new Error(`${path} parece un archivo binario`)

  const lines = text.split('\n')
  const slice = lines.slice(offset - 1, offset - 1 + limit)
  const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join('\n')
  const remaining = lines.length - (offset - 1 + slice.length)
  const footer =
    remaining > 0
      ? `\n\n[${remaining} líneas más. Usa offset=${offset + slice.length}]`
      : ''
  return `${displayPath(abs, ctx.cwd)}:\n${numbered}${footer}`
}
