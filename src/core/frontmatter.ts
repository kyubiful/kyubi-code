// Archivos Markdown con cabecera YAML (comandos, skills, agentes):
//
// ---
// description: Revisa el código
// ---
// Cuerpo del archivo...
export type Frontmatter = { data: Record<string, unknown>; body: string }

export function parseFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { data: {}, body: text }
  const data = Bun.YAML.parse(match[1]!)
  return {
    data:
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : {},
    body: match[2]!,
  }
}

// Lee todos los .md de una carpeta (o los SKILL.md de sus subcarpetas)
export async function readMarkdownDir(
  dir: string,
  pattern = '*.md',
): Promise<{ path: string; name: string; frontmatter: Frontmatter }[]> {
  const results = []
  try {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: dir })) {
      const path = `${dir}/${file}`
      const name = file.replace(/\/SKILL\.md$/, '').replace(/\.md$/, '')
      results.push({
        path,
        name,
        frontmatter: parseFrontmatter(await Bun.file(path).text()),
      })
    }
  } catch {
    // La carpeta no existe: no hay nada que cargar
  }
  return results.sort((a, b) => a.name.localeCompare(b.name))
}
