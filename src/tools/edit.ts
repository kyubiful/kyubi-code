import { z } from 'zod'
import { defineTool, type ToolContext } from '../core/tools'
import { applyFileChange, displayPath, readText, resolvePath } from './fs'

export const editTool = defineTool({
  name: 'edit',
  description: `Reemplaza un fragmento exacto de un archivo por otro.
- oldString debe coincidir exactamente (espacios e indentación incluidos) y ser el único archivo.
  Si aparece varias veces, añade líneas de contexto alrededor o usa replaceall.
- Lee el archivo con read antes de editarlo.`,
  schema: z.object({
    path: z.string().describe('Ruta del archivo'),
    oldString: z.string().min(1).describe('Texto exacto a reemplazar'),
    newString: z.string().describe('Texto nuevo'),
    replaceAll: z
      .boolean()
      .default(false)
      .describe('Reemplaza todas las apariciones'),
  }),
  readOnly: false,
  permissionTarget: (input) => input.path,
  execute: async (input, ctx) => await executeEdit(input, ctx),
})

async function executeEdit(
  {
    path,
    oldString,
    newString,
    replaceAll,
  }: {
    path: string
    oldString: string
    newString: string
    replaceAll: boolean
  },
  ctx: ToolContext,
): Promise<string> {
  const abs = resolvePath(path, ctx)
  const text = await readText(abs)

  if (text === null)
    throw new Error(`No existe: ${path}. Para crearlo usa write.`)
  if (oldString === newString)
    throw new Error('oldString y newString son iguales')

  const count = text.split(oldString).length - 1
  if (count === 0)
    throw new Error(
      `No se encontró oldString en ${path}. Vuelve a leer el archivo y copia el texto exacto.`,
    )
  if (count > 1 && !replaceAll)
    throw new Error(
      `oldString aparece ${count} veces en ${path}. Añade más contexto o usa replaceAll`,
    )

  const updated = replaceAll
    ? text.replaceAll(oldString, () => newString)
    : text.replace(oldString, () => newString) // función: evita que "$&" se interprete
  await applyFileChange(abs, updated, ctx)
  return `Editado ${displayPath(abs, ctx.cwd)} (${replaceAll ? count : 1} reemplazo/s`
}
