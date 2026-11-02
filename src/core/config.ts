// Configuración por capas, de menor a mayor prioridad:
// defaults -> ~/.kyubi/config.json -> .kyubi/config.json -> .kyubi/config.local.json -> flags
// config.local.json es para tus ajustes personales del proyecto (añádelo a .gitignore)
import { join } from 'node:path'
import { z } from 'zod'
import { kyubiHome, projectDir } from './paths'

// Schema-first: el tipo Config se deriva del schema, no se escribe dos veces.
// `.prefault({})` hace que un objeto ausente se rellene con los defaults de sus campos
export const ConfigSchema = z.object({
  provider: z.string().default('openai'),
  model: z.string().optional(),
  permissions: z
    .object({
      mode: z.enum(['default', 'acceptEdits', 'plan']).default('default'),
      allow: z.array(z.string()).default([]), // "bash(git *)", "edit(src/**)"
      ask: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
    })
    .prefault({}),
  hooks: z.record(z.string(), z.unknown()).default({}),
  mcpServers: z.record(z.string(), z.unknown()).default({}),
  env: z.record(z.string(), z.string()).default({}),
})

export type Config = z.infer<typeof ConfigSchema>
export type ConfigInput = z.input<typeof ConfigSchema>

export function configPaths(cwd: string) {
  return {
    user: join(kyubiHome(), 'config.json'),
    project: join(projectDir(cwd), 'config.json'),
    local: join(projectDir(cwd), 'config.local.json'),
  }
}

export async function loadConfig(
  cwd: string,
  overrides: ConfigInput = {},
): Promise<Config> {
  const paths = configPaths(cwd)
  let merged: Record<string, unknown> = {}
  for (const path of [paths.user, paths.project, paths.local]) {
    const layer = await readLayer(path)
    if (layer) merged = mergeConfig(merged, layer)
  }
  merged = mergeConfig(merged, overrides as Record<string, unknown>)
  return ConfigSchema.parse(merged)
}

// Lee y valida una capa. Cada capa se valida por separado para que el error
// diga en qué archivo está el problema
async function readLayer(
  path: string,
): Promise<Record<string, unknown> | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  let data: unknown
  try {
    data = await file.json()
  } catch (error) {
    throw new Error(`${path} no es JSON válido: ${error}`)
  }
  const result = ConfigSchema.safeParse(data)
  if (!result.success) {
    throw new Error(
      `Configuración inválida en ${path}:\n${z.prettifyError(result.error)}`,
    )
  }
  return data as Record<string, unknown>
}

// Merge profundo: los objetos se combinan, los arrays se suman (sin duplicados)
// y los valores simples de la capa más alta ganan
export function mergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue
    const current = result[key]
    if (Array.isArray(current) && Array.isArray(value)) {
      result[key] = [...new Set([...current, ...value])]
    } else if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = mergeConfig(current, value)
    } else {
      result[key] = value
    }
  }
  return result
}

// Añade valores a un archivo de config (p.ej. una regla "permitir siempre")
export async function updateConfigFile(
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const file = Bun.file(path)
  const current = (await file.exists()) ? await file.json() : {}
  await Bun.write(
    path,
    `${JSON.stringify(mergeConfig(current, patch), null, 2)}\n`,
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
