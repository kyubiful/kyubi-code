// Comandos escritos por el usuario usando Markdown:
// ~/.kyubi/commands/review.md (globales)
// .kyubi/commands/review.md (del proyecto)
//
// ---
// description: Revisar los cambios pendientes
// argument-hint: [archivo]
// ---
// Revisa los cambios de git en $ARGUMENTS buscando bugs
import { join } from 'node:path'
import { readMarkdownDir } from '../core/frontmatter'
import { kyubiHome, projectDir } from '../core/paths'
import type { Command } from './types'

export async function loadCustomCommands(cwd: string): Promise<Command[]> {
  const sources = [
    { dir: join(kyubiHome(), 'commands'), source: 'user' as const },
    { dir: join(projectDir(cwd), 'commands'), source: 'project' as const },
  ]
  const commands: Command[] = []
  for (const { dir, source } of sources) {
    for (const file of await readMarkdownDir(dir)) {
      const { data, body } = file.frontmatter
      commands.push({
        name: file.name,
        description: String(data.description ?? `Comando de ${file.path}`),
        argsHint: data['argument-hint']
          ? String(data['argument-hint'])
          : undefined,
        source,
        async run({ args }) {
          const prompt = body.includes('$ARGUMENTS')
            ? body.replaceAll('$ARGUMENTS', args)
            : args
              ? `${body.trim()}\n\n${args}`
              : body
          return { type: 'prompt', prompt: prompt.trim() }
        },
      })
    }
  }
  return commands
}
