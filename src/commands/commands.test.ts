import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../core/config.ts'
import type { AgentEvent } from '../core/events.ts'
import { parseFrontmatter } from '../core/frontmatter.ts'
import { Harness } from '../harness.ts'
import { MockProvider } from '../providers/mock.ts'
import { loadCustomCommands } from './custom.ts'
import { parseCommand } from './index.ts'

let dir: string
const realHome = process.env.KYUBI_HOME
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-commands-'))
  process.env.KYUBI_HOME = join(dir, 'home')
})
afterEach(async () => {
  process.env.KYUBI_HOME = realHome
  await rm(dir, { recursive: true, force: true })
})

function harness(
  commands = [] as Awaited<ReturnType<typeof loadCustomCommands>>,
) {
  return new Harness({
    config: ConfigSchema.parse({ provider: 'mock' }),
    cwd: dir,
    provider: new MockProvider(),
    commands,
  })
}

async function submit(h: Harness, text: string): Promise<AgentEvent[]> {
  const events = await Array.fromAsync(
    h.submit(text, new AbortController().signal),
  )
  await h.session.flush() // antes de que afterEach borre la carpeta
  return events
}

const notices = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === 'notice' ? [e.text] : []))

test('parseCommand y parseFrontmatter', () => {
  expect(parseCommand('/model openai/gpt-5')).toEqual({
    name: 'model',
    args: 'openai/gpt-5',
  })
  expect(parseCommand('hola')).toBeNull()
  expect(parseFrontmatter('---\ndescription: hola\n---\ncuerpo')).toEqual({
    data: { description: 'hola' },
    body: 'cuerpo',
  })
  expect(parseFrontmatter('sin cabecera')).toEqual({
    data: {},
    body: 'sin cabecera',
  })
})

test('/help lista los comandos', async () => {
  const text = notices(await submit(harness(), '/help')).join('\n')
  expect(text).toContain('/clear')
  expect(text).toContain('/model [provider/modelo]')
})

test('/clear borra la conversación', async () => {
  const h = harness()
  await submit(h, 'hola')
  expect(h.agent.messages).toHaveLength(2)
  const events = await submit(h, '/clear')
  expect(h.agent.messages).toHaveLength(0)
  expect(events.some((e) => e.type === 'session_loaded')).toBe(true)
})

test('/model cambia de modelo conservando la conversación', async () => {
  const h = harness()
  await submit(h, 'hola')
  await submit(h, '/model otro-modelo')
  expect(h.model.id).toBe('otro-modelo')
  expect(h.agent.messages).toHaveLength(2)
})

test('un comando desconocido se envía al modelo tal cual', async () => {
  const events = await submit(harness(), '/noexiste')
  expect(events.some((e) => e.type === 'text_delta')).toBe(true)
})

test('los comandos .md se convierten en un prompt con $ARGUMENTS', async () => {
  await Bun.write(
    join(dir, '.kyubi/commands/review.md'),
    '---\ndescription: Revisa un archivo\nargument-hint: <archivo>\n---\nRevisa $ARGUMENTS con cuidado.',
  )
  await Bun.write(join(dir, 'home/commands/hola.md'), 'Saluda')
  const commands = await loadCustomCommands(dir)
  expect(commands.map((c) => [c.name, c.source])).toEqual([
    ['hola', 'user'],
    ['review', 'project'],
  ])
  const h = harness(commands)
  await submit(h, '/review src/a.ts')
  expect(h.agent.messages[0]!.content[0]).toEqual({
    type: 'text',
    text: 'Revisa src/a.ts con cuidado.',
  })
})
