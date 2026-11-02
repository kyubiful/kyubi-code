import { z } from 'zod'
import { defineTool, type ToolContext } from '../core/tools'
import { listFiles, resolvePath } from './fs'

const MAX_LINES = 200

export const grepTool = defineTool({
  name: 'grep',
  description: `Busca una expresión regular en el contenido de los archivos.
Devuelve líneas con el formato "archivo:línea:contenido". Respeta .gitignore.`,
  schema: z.object({
    pattern: z.string().describe('Expresión regular'),
    path: z.string().optional().describe('Directorio o archivo donde buscar'),
    glob: z
      .string()
      .optional()
      .describe('Filtra archivos por glob, ej. "*.ts"'),
    ignoreCase: z.boolean().default(false),
  }),
  readOnly: true,
  execute: async (input, ctx) => await executeGrep(input, ctx),
})

async function executeGrep(
  {
    pattern,
    path,
    glob,
    ignoreCase,
  }: { pattern: string; path?: string; glob?: string; ignoreCase: boolean },
  ctx: ToolContext,
): Promise<string> {
  const target = resolvePath(path ?? '.', ctx)
  const lines = Bun.which('rg')
    ? await ripgrep(pattern, target, glob, ignoreCase, ctx.cwd)
    : await fallback(pattern, target, glob, ignoreCase)
  if (!lines.length) return 'Sin coincidencias'
  const extra = lines.length - MAX_LINES
  const shown = lines.slice(0, MAX_LINES).join('\n')
  return extra > 0
    ? `${shown}\n\n[${extra} coincidencias más: afina la búsqueda]`
    : shown
}

async function ripgrep(
  pattern: string,
  target: string,
  glob: string | undefined,
  ignoreCase: boolean,
  cwd: string,
): Promise<string[]> {
  const args = [
    'rg',
    '--line-number',
    '--no-heading',
    '--color',
    'never',
    '--max-columns',
    '300',
  ]

  if (ignoreCase) args.push('-i')
  if (glob) args.push('--glob', glob)
  args.push('-e', pattern, target)
  const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (code === 2) throw new Error(err.trim()) // 1 = sin coincidencias, 2 = error
  return out.split('\n').filter(Boolean)
}

// Sin ripgrep: recorre los archivos a mano
async function fallback(
  pattern: string,
  target: string,
  glob: string | undefined,
  ignoreCase: boolean,
): Promise<string[]> {
  const regex = new RegExp(pattern, ignoreCase ? 'i' : '')
  const filter = glob ? new Bun.Glob(glob) : null
  const results: string[] = []
  for (const file of await listFiles(target)) {
    if (filter && !filter.match(file.split('/').at(-1)!) && !filter.match(file))
      continue
    const text = await Bun.file(`${target}/${file}`)
      .text()
      .catch(() => '')
    if (text.includes('\0')) continue
    text.split('\n').forEach((line, i) => {
      if (regex.test(line))
        results.push(`${file}:${i + 1}:${line.slice(0, 300)}`)
    })
    if (results.length > MAX_LINES * 2) break
  }
  return results
}
