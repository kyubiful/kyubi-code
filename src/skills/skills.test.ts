import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../core/config'
import { messageText } from '../core/types'
import { Harness } from '../harness'
import { MockProvider } from '../providers/mock'
import { loadSkills } from './index'

let dir: string
const realHome = process.env.KYUBI_HOME
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-skills-'))
  process.env.KYUBI_HOME = join(dir, 'home')
  await Bun.write(
    join(dir, '.kyubi/skills/commit-style/SKILL.md'),
    '---\nname: commit-style\ndescription: Cómo escribir commits. Úsala antes de hacer un commit.\n---\nUsa Conventional Commits.',
  )
  await Bun.write(
    join(dir, 'home/skills/global/SKILL.md'),
    '---\ndescription: Una skill global\n---\nGlobal.',
  )
})
afterEach(async () => {
  process.env.KYUBI_HOME = realHome
  await rm(dir, { recursive: true, force: true })
})

test('carga las skills globales y del proyecto', async () => {
  const skills = await loadSkills(dir)
  expect(skills.map((s) => [s.name, s.source])).toEqual([
    ['global', 'user'],
    ['commit-style', 'project'],
  ])
})

test('el modelo solo ve la descripción hasta que llama a la tool', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'skill', input: { name: 'commit-style' } }] },
    { text: 'feat: añade login' },
  ])
  const h = new Harness({
    config: ConfigSchema.parse({ provider: 'mock' }),
    cwd: dir,
    provider,
    skills: await loadSkills(dir),
  })
  await Array.fromAsync(h.submit('haz un commit', new AbortController().signal))
  const firstRequest = provider.requests[0]!
  const spec = firstRequest.tools.find((t) => t.name === 'skill')!
  expect(spec.description).toContain('commit-style: Cómo escribir commits')
  expect(JSON.stringify(firstRequest)).not.toContain('Conventional Commits')
  // Tras llamar a la tool, el contenido entra en la conversación
  expect(JSON.stringify(h.agent.messages)).toContain(
    'Usa Conventional Commits.',
  )
})

test('/nombre-de-skill fuerza la skill', async () => {
  const h = new Harness({
    config: ConfigSchema.parse({ provider: 'mock' }),
    cwd: dir,
    provider: new MockProvider(),
    skills: await loadSkills(dir),
  })
  await Array.fromAsync(
    h.submit('/commit-style arregla el typo', new AbortController().signal),
  )
  const prompt = messageText(h.agent.messages[0]!)
  expect(prompt).toContain('Usa Conventional Commits.')
  expect(prompt).toEndWith('arregla el typo')
})
