import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { MockProvider } from '../providers/mock'
import { Agent } from './agent'
import type { AgentEvent } from './events'
import {
  matchesRule,
  parseRule,
  Permissions,
  type PermissionAnswer,
} from './permissions'
import { defineTool, ToolRegistry } from './tools'

const readTool = defineTool({
  name: 'read',
  description: '',
  schema: z.object({ path: z.string() }),
  readOnly: true,
  permissionTarget: (i) => i.path,
  async execute() {
    return 'contenido'
  },
})
const bashTool = defineTool({
  name: 'bash',
  description: '',
  schema: z.object({ command: z.string() }),
  readOnly: false,
  permissionTarget: (i) => i.command,
  async execute(i) {
    return `ejecutado: ${i.command}`
  },
})
const editTool = { ...bashTool, name: 'edit' }

const perms = (
  p: Partial<{
    mode: 'default' | 'acceptEdits' | 'plan'
    allow: string[]
    ask: string[]
    deny: string[]
  }>,
) => new Permissions({ mode: 'default', allow: [], ask: [], deny: [], ...p })

test('parseRule y matchesRule', () => {
  expect(parseRule('bash(git *)')).toEqual({ tool: 'bash', pattern: 'git *' })
  expect(parseRule('read')).toEqual({ tool: 'read' })
  expect(
    matchesRule(parseRule('bash(git *)'), 'bash', 'git log src/a.ts'),
  ).toBe(true)
  expect(matchesRule(parseRule('bash(git *)'), 'bash', 'rm -rf /')).toBe(false)
  expect(matchesRule(parseRule('mcp__github__*'), 'mcp__github__issues')).toBe(
    true,
  )
  expect(matchesRule(parseRule('edit(src/*)'), 'edit', 'src/a/b.ts')).toBe(true)
})

test('defaults: solo lectura se permite, el resto se pregunta', () => {
  expect(perms({}).evaluate(readTool, 'a.ts')).toBe('allow')
  expect(perms({}).evaluate(bashTool, 'ls')).toBe('ask')
})

test('orden: deny > plan > ask > allow', () => {
  expect(
    perms({ allow: ['bash'], deny: ['bash(rm *)'] }).evaluate(
      bashTool,
      'rm -rf x',
    ),
  ).toBe('deny')
  expect(perms({ allow: ['bash'] }).evaluate(bashTool, 'ls')).toBe('allow')
  expect(perms({ ask: ['read(.env)'] }).evaluate(readTool, '.env')).toBe('ask')
  expect(
    perms({ mode: 'plan', allow: ['bash'] }).evaluate(bashTool, 'ls'),
  ).toBe('deny')
  expect(perms({ mode: 'plan' }).evaluate(readTool, 'a')).toBe('allow')
})

test('acceptEdits permite editar pero no bash', () => {
  expect(perms({ mode: 'acceptEdits' }).evaluate(editTool, 'a.ts')).toBe(
    'allow',
  )
  expect(perms({ mode: 'acceptEdits' }).evaluate(bashTool, 'ls')).toBe('ask')
})

// Integración con el agente

function agentWith(permissions: Permissions) {
  return new Agent({
    provider: new MockProvider([
      { toolCalls: [{ name: 'bash', input: { command: 'ls' } }] },
      { text: 'fin' },
      { toolCalls: [{ name: 'bash', input: { command: 'ls' } }] },
      { text: 'fin' },
    ]),
    model: 'mock',
    tools: new ToolRegistry([bashTool, readTool]),
    system: '',
    cwd: '.',
    permissions,
  })
}

async function runAnswering(agent: Agent, answer: PermissionAnswer) {
  const events: AgentEvent[] = []
  for await (const ev of agent.run('hi', new AbortController().signal)) {
    events.push(ev)
    if (ev.type === 'permission_request') ev.request.respond(answer)
  }
  return events
}

test('el agente pregunta y respeta "deny"', async () => {
  const agent = agentWith(perms({}))
  const events = await runAnswering(agent, 'deny')
  expect(events.some((e) => e.type === 'permission_request')).toBe(true)
  expect(events.find((e) => e.type === 'tool_end')).toMatchObject({
    isError: true,
  })
  expect(agent.messages[2]!.content[0]).toMatchObject({
    type: 'tool_result',
    isError: true,
  })
})

test('"allow_once" ejecuta la tool', async () => {
  const events = await runAnswering(agentWith(perms({})), 'allow_once')
  expect(events.find((e) => e.type === 'tool_end')).toMatchObject({
    isError: false,
    result: 'ejecutado: ls',
  })
})

let dir: string | undefined
afterEach(() => dir && rm(dir, { recursive: true, force: true }))

test('"allow_always" no vuelve a preguntar y guarda la regla', async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-perms-'))
  const savePath = join(dir, 'config.local.json')
  const agent = agentWith(
    new Permissions(
      { mode: 'default', allow: [], ask: [], deny: [] },
      savePath,
    ),
  )
  const first = await runAnswering(agent, 'allow_always')
  expect(first.filter((e) => e.type === 'permission_request')).toHaveLength(1)
  const second = await runAnswering(agent, 'deny')
  expect(second.filter((e) => e.type === 'permission_request')).toHaveLength(0)
  expect(await Bun.file(savePath).json()).toEqual({
    permissions: { allow: ['bash(ls)'] },
  })
})

test('sin interactividad, lo que haya que preguntar se deniega', async () => {
  const agent = agentWith(
    new Permissions(
      { mode: 'default', allow: [], ask: [], deny: [] },
      undefined,
      false,
    ),
  )
  const events = await runAnswering(agent, 'allow_once')
  expect(events.some((e) => e.type === 'permission_request')).toBe(false)
  expect(events.find((e) => e.type === 'tool_end')).toMatchObject({
    isError: true,
  })
})
