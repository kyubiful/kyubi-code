import { expect, test } from 'bun:test'
import { z } from 'zod'
import { echoTool } from '../tools/echo'
import { defineTool, ToolRegistry, truncate } from './tools'

const ctx = { cwd: '.', signal: new AbortController().signal, agentId: 'test' }

test('specs() genera JSON Schema', () => {
  const registry = new ToolRegistry([echoTool])
  expect(registry.specs()).toEqual([
    {
      name: 'echo',
      description: echoTool.description,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Texto a devolver' },
        },
        required: ['text'],
      },
    },
  ])
})

test('ejecuta una tool válida', async () => {
  const registry = new ToolRegistry([echoTool])
  expect(await registry.run('echo', { text: 'hola' }, ctx)).toEqual({
    content: 'hola',
    isError: false,
  })
})

test('un input inválido devuelve un error legible sin lanzar', async () => {
  const registry = new ToolRegistry([echoTool])
  const result = await registry.run('echo', { text: 42 }, ctx)
  expect(result.isError).toBe(true)
  expect(result.content).toContain('input inválido para echo')
  expect(result.content).toContain('text')
})

test('una tool que lanza devuelve isError', async () => {
  const boom = defineTool({
    name: 'boom',
    description: 'falla',
    schema: z.object({}),
    readOnly: true,
    async execute() {
      throw new Error('explotó!!')
    },
  })
  const registry = new ToolRegistry([boom])
  expect(await registry.run('boom', {}, ctx)).toEqual({
    content: 'Error: explotó!!',
    isError: true,
  })
})

test('una tool inexistente devuelve isError', async () => {
  const result = await new ToolRegistry().run('nope', {}, ctx)
  expect(result.isError).toBe(true)
})

test('truncate recorta salidas largas', () => {
  expect(truncate('abcdef', 3)).toStartWith('abc\n\n[...salida truncada: 3')
  expect(truncate('abc', 3)).toBe('abc')
})
