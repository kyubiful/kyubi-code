// El system prompt: intstrucciones base + instrucciones del usuario (AGENTS.md / KYUBI.md)
// + información del entorno. Se construye una vez por sesión
//
// Orden pensado para la caché de prompts: lo más estable primero
import { join, relative, sep } from 'node:path'
import { kyubiHome, projectRoot } from './paths'
import basePrompt from './prompts/system.md' with { type: 'text' }

export type EnvInfo = {
  cwd: string
  platform: string
  date: string
  git?: { branch: string; status: string }
}

export type InstructionFile = {
  path: string
  scope: 'global' | 'project'
  content: string
}
const INSTRUCTION_FILES = ['AGENTS.md', 'KYUBI.md']

export async function buildSystemPrompt(cwd: string): Promise<string> {
  const instructions = await loadInstructions(cwd)
  const env = gatherEnv(cwd)
  const parts = [basePrompt.trim()]

  if (instructions.length) {
    parts.push(
      '# Instrucciones del usuario\n\nSíguelas: tienen prioridad sobre las instrucciones generales.',
      ...instructions.map(
        (file) => `## ${file.path}\n\n${file.content.trim()}`,
      ),
    )
  }
  parts.push(formatEnv(env))
  return parts.join('\n\n')
}

// Global (~/.kyubi) y después cada carpeta desde la raíz del repo hasta el cwd,
// para que las instrucciones más específicas queden al final
export async function loadInstructions(
  cwd: string,
): Promise<InstructionFile[]> {
  const files: InstructionFile[] = []
  const add = async (dir: string, scope: InstructionFile['scope']) => {
    for (const name of INSTRUCTION_FILES) {
      const file = Bun.file(join(dir, name))
      if (await file.exists()) {
        files.push({ path: join(dir, name), scope, content: await file.text() })
      }
    }
  }
  await add(kyubiHome(), 'global')

  const root = projectRoot(cwd)
  const rel = relative(root, cwd)
  const dirs = [root]
  if (rel && !rel.startsWith('..')) {
    let current = root
    for (const part of rel.split(sep)) {
      current = join(current, part)
      dirs.push(current)
    }
  }
  for (const dir of dirs) await add(dir, 'project')
  return files
}

export function gatherEnv(cwd: string): EnvInfo {
  const env: EnvInfo = {
    cwd,
    platform: `${process.platform} (${process.arch})`,
    date: new Date().toISOString().slice(0, 10),
  }
  if (git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true') {
    // branch --show-current funciona también en un repo sin commits
    const branch = git(cwd, ['branch', '--show-current']) || '(detached)'
    const status = git(cwd, ['status', '--short']) ?? ''
    const lines = status.split('\n').filter(Boolean)
    env.git = {
      branch,
      status: lines.length
        ? lines.slice(0, 30).join('\n') +
          (lines.length > 30 ? `\n... y ${lines.length - 30} más` : '')
        : '(sin cambios)',
    }
  }
  return env
}

function formatEnv(env: EnvInfo): string {
  const lines = [
    '# Entorno',
    '',
    `- Directorio de trabajo: ${env.cwd}`,
    `- Plataforma: ${env.platform}`,
    `- Fecha: ${env.date}`,
  ]
  if (env.git) {
    lines.push(
      `- Repositorio git, rama: ${env.git.branch}`,
      '',
      'Estado de git al empezar la sesión:',
      '```',
      env.git.status,
      '```',
    )
  } else {
    lines.push('- No es un repositorio git')
  }
  return lines.join('\n')
}

function git(cwd: string, args: string[]): string | null {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  return result.exitCode === 0 ? result.stdout.toString().trim() : null
}
