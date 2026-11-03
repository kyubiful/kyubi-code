import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../core/config'
import { userMessage } from '../core/types'
import { Harness } from '../harness'
import { MockProvider, type MockTurn } from '../providers/mock'
import {
  cleanupSessions,
  deleteSession,
  exportMarkdown,
  listSessions,
} from './manager'
import { SessionStore } from './store'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-manager-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

function harness(script?: MockTurn[]) {
  return new Harness({
    config: ConfigSchema.parse({
      provider: 'mock',
      permissions: { mode: 'acceptEdits' },
    }),
    cwd: dir,
    provider: new MockProvider(script),
  })
}

async function say(h: Harness, text: string) {
  await Array.fromAsync(h.submit(text, new AbortController().signal))
  await h.flush()
}

test('rewind de conversación y código', async () => {
  const file = join(dir, 'a.txt')
  const h = harness([
    { toolCalls: [{ name: 'write', input: { path: 'a.txt', content: 'v1' } }] },
    { text: 'creado' },
    {
      toolCalls: [
        {
          name: 'edit',
          input: { path: 'a.txt', oldString: 'v1', newString: 'v2' },
        },
      ],
    },
    { text: 'editado' },
    { text: 'rama nueva' },
  ])
  await say(h, 'crea a.txt')
  await say(h, 'cámbialo a v2')
  expect(await Bun.file(file).text()).toBe('v2')

  const second = h.agent.messages.find((m) =>
    m.content.some((b) => b.type === 'text' && b.text === 'cámbialo a v2'),
  )!
  const { restored } = await h.rewind(second.id, 'both')
  expect(restored).toEqual([file])
  expect(await Bun.file(file).text()).toBe('v1')
  // La conversación vuelve a antes del segundo mensaje
  expect(h.agent.messages.at(-1)!.content).toEqual([
    { type: 'text', text: 'creado' },
  ])

  // Seguimos por una rama nueva y la vieja queda guardada en el archivo
  await say(h, 'otra cosa')
  const reloaded = await SessionStore.open(h.session.path)
  const texts = reloaded
    .messages()
    .flatMap((m) =>
      m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])),
    )
  expect(texts).toEqual(['crea a.txt', 'creado', 'otra cosa', 'rama nueva'])
  expect(JSON.stringify(reloaded.all())).toContain('cámbialo a v2')
})

test('rewind solo de código: la conversación no cambia', async () => {
  const h = harness([
    { toolCalls: [{ name: 'write', input: { path: 'b.txt', content: 'x' } }] },
    { text: 'ok' },
  ])
  await say(h, 'crea b.txt')
  const count = h.agent.messages.length
  await h.rewind(h.agent.messages[0]!.id, 'code')
  expect(await Bun.file(join(dir, 'b.txt')).exists()).toBe(false) // no existía antes
  expect(h.agent.messages).toHaveLength(count)
})

test('fork copia la conversación a una sesión nueva', async () => {
  const h = harness()
  await say(h, 'hola')
  const original = h.session.id
  h.fork()
  await say(h, 'en el fork')
  expect(h.session.id).not.toBe(original)
  expect(h.session.header.parentSessionId).toBe(original)
  expect(h.agent.messages).toHaveLength(4)
  expect((await SessionStore.find(dir, original)).messages()).toHaveLength(2)
})

test('título, listado, export y borrado', async () => {
  const h = harness()
  await say(h, 'arregla el bug del login')
  const [meta] = await listSessions(dir)
  expect(meta).toMatchObject({
    id: h.session.id,
    title: 'arregla el bug del login',
    messageCount: 2,
  })

  h.rename('Bug del login')
  await h.flush()
  expect((await listSessions(dir))[0]!.title).toBe('Bug del login')

  const markdown = exportMarkdown(h.session)
  expect(markdown).toContain('# Bug del login')
  expect(markdown).toContain('## Usuario\n\narregla el bug del login')

  await deleteSession(dir, h.session.id.slice(0, 8))
  expect(await listSessions(dir)).toEqual([])
})

test('cleanupSessions borra las sesiones antiguas', async () => {
  const old = SessionStore.create(dir)
  old.append({ type: 'message', message: userMessage('vieja') })
  await old.flush()
  const past = new Date(Date.now() - 40 * 24 * 3600_000)
  await utimes(old.path, past, past)
  const recent = SessionStore.create(dir)
  recent.append({ type: 'message', message: userMessage('nueva') })
  await recent.flush()

  expect(await cleanupSessions(dir, 30)).toBe(1)
  expect((await listSessions(dir)).map((s) => s.id)).toEqual([recent.id])
})

test('/rewind elige con select_request', async () => {
  const h = harness([{ text: 'uno' }, { text: 'dos' }])
  await say(h, 'primero')
  await say(h, 'segundo')
  for await (const ev of h.submit('/rewind', new AbortController().signal)) {
    if (ev.type === 'select_request') ev.request.respond(0) // el más reciente: "segundo"
  }
  expect(h.agent.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
})
