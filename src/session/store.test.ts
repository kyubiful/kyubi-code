import { afterEach, beforeEach, expect, test } from 'bun:test'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '../core/config'
import { userMessage } from '../core/types'
import { Harness } from '../harness'
import { MockProvider } from '../providers/mock'
import { SessionStore } from './store'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-session-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

test('no crea el archivo hasta la primera entrada', async () => {
  const store = SessionStore.create(dir)
  await store.flush()
  expect(await Bun.file(store.path).exists()).toBe(false)
  store.append({ type: 'message', message: userMessage('hola') })
  await store.flush()
  expect(await Bun.file(store.path).exists()).toBe(true)
})

test('guarda y vuelve a cargar los mensajes en orden', async () => {
  const store = SessionStore.create(dir)
  const a = userMessage('uno')
  const b = userMessage('dos')
  store.append({ type: 'message', message: a })
  store.append({
    type: 'usage',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'm',
  })
  store.append({ type: 'message', message: b })
  await store.flush()
  const loaded = await SessionStore.open(store.path)
  expect(loaded.messages()).toEqual([a, b])
  expect(loaded.all().map((e) => e.parentId)).toEqual([
    null,
    a.id,
    loaded.all()[1]!.id,
  ])
})

test('ignora una última línea rota (crash a mitad de escritura)', async () => {
  const store = SessionStore.create(dir)
  store.append({ type: 'message', message: userMessage('ok') })
  await store.flush()
  await appendFile(store.path, '{"id":"x","type":"mess')
  expect((await SessionStore.open(store.path)).messages()).toHaveLength(1)
})

test('find acepta el comienzo del id y latest devuelve la más reciente', async () => {
  const first = SessionStore.create(dir)
  first.append({ type: 'message', message: userMessage('1') })
  await first.flush()
  await Bun.sleep(10)
  const second = SessionStore.create(dir)
  second.append({ type: 'message', message: userMessage('2') })
  await second.flush()
  expect((await SessionStore.find(dir, first.id.slice(0, 8))).id).toBe(first.id)
  expect((await SessionStore.latest(dir))!.id).toBe(second.id)
})

test('el harness guarda la conversación y --continue la retoma', async () => {
  const config = ConfigSchema.parse({ provider: 'mock' })
  const h1 = new Harness({ config, cwd: dir, provider: new MockProvider() })
  await Array.fromAsync(
    h1.submit('me llamo Sergio', new AbortController().signal),
  )
  await h1.session.flush()

  const resumed = await SessionStore.latest(dir)
  const h2 = new Harness({
    config,
    cwd: dir,
    provider: new MockProvider(),
    session: resumed!,
  })
  expect(h2.agent.messages).toEqual(h1.agent.messages)
  expect(h2.session.id).toBe(h1.session.id)
})
