import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configPaths,
  loadConfig,
  mergeConfig,
  updateConfigFile,
} from './config'
import { config, permission } from 'node:process'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-config-'))
  process.env.KYUBI_HOME = join(dir, 'home')
})
afterEach(async () => {
  delete process.env.KYUBI_HOME
  await rm(dir, { recursive: true, force: true })
})

test('sin archivos, devuelve los defaults', async () => {
  const config = await loadConfig(dir)
  expect(config.provider).toBe('openai')
  expect(config.permissions).toEqual({
    mode: 'default',
    allow: [],
    ask: [],
    deny: [],
  })
})

test('las capas se combinan: los arrays se suman y gana la más alta', async () => {
  const paths = configPaths(dir)
  await Bun.write(
    paths.user,
    JSON.stringify({ model: 'a', permissions: { allow: ['read'] } }),
  )
  await Bun.write(
    paths.project,
    JSON.stringify({ model: 'b', permissions: { allow: ['glob'] } }),
  )
  await Bun.write(
    paths.local,
    JSON.stringify({ permissions: { allow: ['read', 'bash(1s)'] } }),
  )
  const config = await loadConfig(dir)
  expect(config.model).toBe('b')
  expect(config.permissions.allow).toEqual(['read', 'glob', 'bash(1s)'])
})

test('los flags se sobrescriben a los archivos', async () => {
  await Bun.write(configPaths(dir).user, JSON.stringify({ model: 'a' }))
  expect((await loadConfig(dir, { model: undefined })).model).toBe('a')
})

test('un archivo inválido da un error con su ruta', async () => {
  const path = configPaths(dir).project
  await Bun.write(path, JSON.stringify({ permissions: { mode: 'yolo' } }))
  expect(loadConfig(dir)).rejects.toThrow(path)
})

test('mergeConfig y updateConfigFile', async () => {
  expect(mergeConfig({ a: { b: 1, c: [1] } }, { a: { c: [2] } })).toEqual({
    a: { b: 1, c: [1, 2] },
  })
  const path = join(dir, 'x.json')
  await updateConfigFile(path, { permission: { allow: ['read'] } })
  await updateConfigFile(path, { permission: { allow: ['bash(1s)'] } })
  expect(await Bun.file(path).json()).toEqual({
    permission: { allow: ['read', 'bash(1s)'] },
  })
})
