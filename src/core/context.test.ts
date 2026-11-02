import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSystemPrompt, loadInstructions } from './context.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-context-'))
  process.env.KYUBI_HOME = join(dir, 'home')
  Bun.spawnSync(['git', 'init', '-q', '-b', 'main'], { cwd: join(dir) })
})
afterEach(async () => {
  delete process.env.KYUBI_HOME
  await rm(dir, { recursive: true, force: true })
})

test('carga las instrucciones globales y del proyecto, de general a específico', async () => {
  await Bun.write(join(dir, 'home/KYUBI.md'), 'global')
  await Bun.write(join(dir, 'AGENTS.md'), 'raíz')
  await mkdir(join(dir, 'pkg/sub'), { recursive: true })
  await Bun.write(join(dir, 'pkg/KYUBI.md'), 'paquete')
  const files = await loadInstructions(join(dir, 'pkg/sub'))
  expect(files.map((f) => f.content)).toEqual(['global', 'raíz', 'paquete'])
})

test('el system prompt incluye las instrucciones y el entorno', async () => {
  await Bun.write(join(dir, 'KYUBI.md'), 'Responde siempre en español.')
  const prompt = await buildSystemPrompt(dir)
  expect(prompt).toStartWith('Eres kyubi')
  expect(prompt).toContain('Responde siempre en español.')
  expect(prompt).toContain(`Directorio de trabajo: ${dir}`)
  expect(prompt).toContain('rama: main')
  expect(prompt).toContain('?? KYUBI.md')
})
