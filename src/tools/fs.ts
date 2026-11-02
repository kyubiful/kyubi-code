// utilidades compartidas por las tools de archivos
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { FileChange, ToolContext } from '../core/tools'

export function resolvePath(path: string, ctx: ToolContext): string {
  return isAbsolute(path) ? path : resolve(ctx.cwd, path)
}

// ruta relativa al cwd para mostrar y para los permisos
export function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path)
  return rel.startsWith('..') ? path : rel || '.'
}

export async function readText(path: string): Promise<string | null> {
  const file = Bun.file(path)
  return (await file.exists()) ? await file.text() : null
}

// Todos los cambios a archivos paran por aquí: así se pueden registrar y deshacer
export async function applyFileChange(
  path: string,
  newContent: string,
  ctx: ToolContext,
) {
  const before = await readText(path)
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, newContent)
  const change: FileChange = { path, before, after: newContent }
  ctx.recordFileChange?.(change)
  return change
}

// Lista los archivos de un directorio respetando .gitignore cuando es un repo git
export async function listFiles(dir: string): Promise<string[]> {
  const git = Bun.spawnSync(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: dir, stdout: 'pipe', stdin: 'ignore' },
  )
  if (git.exitCode === 0) {
    return git.stdout.toString().split('\0').filter(Boolean).sort()
  }
  const files: string[] = []
  for await (const file of new Bun.Glob('**/*').scan({ cwd: dir, dot: true })) {
    if (/(^|\/)(node_modules|\.git)\//.test(file)) continue
    files.push(file)
  }
  return files.sort()
}
