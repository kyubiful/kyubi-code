// Skills: instrucciones que el modelo carga solo cuando las necesita
//
// ~/.kyubi/skills/<nombre>/SKILL.md    (globales)
// .kyubi/skills/<nombre>/SKILL.md      (del proyecto)
//
// ---
// name: commit-style
// description: Cómo escribir mensajes de commit en este proyecto. Úsala antes de hacer un commit.
// ---
// Instrucciones...
//
// El modelo solo ve el nombre y la descripción (en la tool `skill`). El cuerpo entra
// en el contexto cuando llama a skill({ name }), o cuando el usuario escribe /nombre
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { Command } from '../commands/types'
import { readMarkdownDir } from '../core/frontmatter'
import { kyubiHome, projectDir } from '../core/paths'
import { defineTool } from '../core/tools'

export type SkillMeta = {
  name: string
  description: string // lo único que ve el modelo hasta que la invoca
  path: string // ruta al SKILL.md (el cuerpo se lee bajo demanda)
  source: 'user' | 'project'
}

export async function loadSkills(cwd: string): Promise<SkillMeta[]> {
  const sources = [
    { dir: join(kyubiHome(), 'skills'), source: 'user' as const },
    { dir: join(projectDir(cwd), 'skills'), source: 'project' as const },
  ]
  const skills = new Map<string, SkillMeta>()
  for (const { dir, source } of sources) {
    for (const file of await readMarkdownDir(dir, '*/SKILL.md')) {
      const { data } = file.frontmatter
      const name = String(data.name ?? file.name)
      // Una skill del proyecto sustituye a una global con el mismo nombre
      skills.set(name, {
        name,
        description: String(data.description ?? ''),
        path: file.path,
        source,
      })
    }
  }
  return [...skills.values()]
}

async function skillContent(skill: SkillMeta): Promise<string> {
  const text = await Bun.file(skill.path).text()
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  return `<skill name="${skill.name}">\n${body.trim()}\n\nLos archivos auxiliares de esta skill están en ${dirname(skill.path)}\n</skill>`
}

export function skillTool(skills: SkillMeta[]) {
  const list = skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join('\n')
  return defineTool({
    name: 'skill',
    description: `Carga las instrucciones de una skill. Si la tarea encaja con la descripción de alguna, cárgala ANTES de empezar y síguela. Skills disponibles:
${list}`,
    schema: z.object({ name: z.string().describe('Nombre de la skill') }),
    readOnly: true,
    async execute({ name }) {
      const skill = skills.find((s) => s.name === name)
      if (!skill)
        throw new Error(
          `No existe la skill "${name}". Disponibles: ${skills.map((s) => s.name).join('\n')}`,
        )
      return skillContent(skill)
    },
  })
}

// Cada skill también es un comando. /nombre [lo que quieras añadir]
export function skillCommands(skills: SkillMeta[]): Command[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: `(skill) ${skill.description}`,
    argsHint: '[petición]',
    source: skill.source,
    async run({ args }) {
      const content = await skillContent(skill)
      return {
        type: 'prompt',
        prompt: args ? `${content}\n\n${args}` : content,
      }
    },
  }))
}
