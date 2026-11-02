import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolRegistry, type FileChange, type ToolContext } from '../core/tools'
import { buildinTools } from '.'

let dir: string
let ctx: ToolContext
let changes: FileChange[]
const tools = new ToolRegistry(buildinTools())

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-tools-'))
  changes = []
  ctx = {
    cwd: dir,
    signal: new AbortController().signal,
    agentId: 'test',
    recordFileChange: (change) => changes.push(change),
  }
})

afterEach(() => rm(dir, { recursive: true, force: true }))

const run = (name: string, input: unknown) => tools.run(name, input, ctx)

test('write crea el archivo (y sus carpetas) y registra el cambio', async () => {
  const result = await run('write', { path: 'a/b.txt', content: 'hola\nmundo' })
  expect(result).toEqual({
    content: 'Creado: a/b.txt (2 líneas)',
    isError: false,
  })
  expect(await Bun.file(join(dir, 'a/b.txt')).text()).toBe('hola\nmundo')
  expect(changes).toEqual([
    { path: join(dir, 'a/b.txt'), before: null, after: 'hola\nmundo' },
  ])
})

test('read devuelve líneas numeradas y respeta offset/limit', async () => {
  await Bun.write(join(dir, 'f.txt'), 'uno\ndos\ntres\ncuatro')
  expect((await run('read', { path: 'f.txt' })).content).toBe(
    'f.txt:\n1\tuno\n2\tdos\n3\ttres\n4\tcuatro',
  )
  const part = await run('read', { path: 'f.txt', offset: 2, limit: 2 })
  expect(part.content).toBe(
    'f.txt:\n2\tdos\n3\ttres\n\n[1 líneas más. Usa offset=4]',
  )

  expect((await run('read', { path: 'nope.txt' })).isError).toBe(true)
})

test('edit reemplaza un fragmento único', async () => {
  await Bun.write(join(dir, 'f.ts'), 'const a = 1\nconst b = 2\n')
  const result = await run('edit', {
    path: 'f.ts',
    oldString: 'b = 2',
    newString: 'b = 3',
  })

  expect(result.isError).toBe(false)
  expect(await Bun.file(join(dir, 'f.ts')).text()).toBe(
    'const a = 1\nconst b = 3\n',
  )
  expect(changes[0]!.before).toBe('const a = 1\nconst b = 2\n')
})

test('edit falla si oldString no es único, salvo con replaceAll', async () => {
  await Bun.write(join(dir, 'f.ts'), 'x\nx\n')
  const fail = await run('edit', {
    path: 'f.ts',
    oldString: 'x',
    newString: 'y',
  })
  expect(fail.isError).toBe(true)
  expect(fail.content).toContain('aparece 2 veces')
  const ok = await run('edit', {
    path: 'f.ts',
    oldString: 'x',
    newString: '$&',
    replaceAll: true,
  })

  expect(ok.isError).toBe(false)
  expect(await Bun.file(join(dir, 'f.ts')).text()).toBe('$&\n$&\n')
})

test('edit falla si no encuentra el texto', async () => {
  await Bun.write(join(dir, 'f.ts'), 'abc')
  const result = await run('edit', {
    path: 'f.ts',
    oldString: 'zzz',
    newString: 'y',
  })
  expect(result.content).toContain('No se encontró')
})

test('glob busca por patrón y respeta .gitignore', async () => {
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir })
  await Bun.write(join(dir, '.gitignore'), 'ignorado/\n')
  await Bun.write(join(dir, 'src/a.ts'), '')
  await Bun.write(join(dir, 'src/b.js'), '')
  await Bun.write(join(dir, 'ignorado/c.ts'), '')
  expect((await run('glob', { pattern: '**/*.ts' })).content).toBe('src/a.ts')
})

test('grep encuentra coincidencias con su línea', async () => {
  await Bun.write(join(dir, 'a.ts'), 'uno\nfunction hola() {}\n')
  await Bun.write(join(dir, 'b.ts'), 'nada')
  const result = await run('grep', { pattern: 'function \\w+' })
  expect(result.content).toContain('a.ts:2:function hola() {}')
  expect(result.content).not.toContain('b.ts')
  expect((await run('grep', { pattern: 'zzz' })).content).toBe(
    'Sin coincidencias',
  )
})

test('bash ejecuta en el cwd, junta stderr e informa del exit code', async () => {
  const result = await run('bash', { command: 'pwd; echo error >&2; exit 3' })
  expect(result.content).toBe(`${dir}\nerror\n[exit code 3]`)
})

test('bash respeta el timeout', async () => {
  const result = await run('bash', { command: 'sleep 5', timeoutMs: 1_000 })
  expect(result.content).toContain('superó 1000ms')
})

test('bash se cancela con el AbortSignal', async () => {
  const controller = new AbortController()
  const pending = tools.run(
    'bash',
    { command: 'sleep 5' },
    { ...ctx, signal: controller.signal },
  )
  setTimeout(() => controller.abort(), 100)
  expect((await pending).content).toContain('cancelado por el usuario')
})
