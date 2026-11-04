import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema, type ConfigInput } from '../core/config'
import type { AgentEvent } from '../core/events'
import { messageText } from '../core/types'
import { Harness } from '../harness'
import { MockProvider, type MockScript } from '../providers/mock'
import { HookRunner } from './runner'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kyubi-hooks-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

function harness(hooks: ConfigInput['hooks'], script?: MockScript) {
  return new Harness({
    config: ConfigSchema.parse({
      provider: 'mock',
      hooks,
      permissions: { mode: 'acceptEdits', allow: ['bash'] },
    }),
    cwd: dir,
    provider: new MockProvider(script),
  })
}

async function say(h: Harness, text: string): Promise<AgentEvent[]> {
  const events = await Array.fromAsync(
    h.submit(text, new AbortController().signal),
  )
  await h.flush()
  return events
}

test('exit 2 bloquea y stderr es el motivo; stdout JSON se interpreta', async () => {
  const runner = new HookRunner(
    {
      PreToolUse: [
        {
          matcher: 'bash',
          command:
            'grep -q "rm -rf" && { echo "nada de rm -rf" >&2; exit 2; } || true',
          timeoutMs: 5000,
        },
        {
          matcher: 'edit|write',
          command: `echo '{"additionalContext":"ok"}'`,
          timeoutMs: 5000,
        },
      ],
    },
    dir,
    () => 's1',
  )
  expect(
    await runner.run(
      { event: 'PreToolUse', toolName: 'bash', input: { command: 'rm -rf /' } },
      'bash',
    ),
  ).toEqual({
    decision: 'block',
    reason: 'nada de rm -rf',
  })
  expect(
    await runner.run(
      { event: 'PreToolUse', toolName: 'bash', input: { command: 'ls' } },
      'bash',
    ),
  ).toEqual({})
  expect(
    await runner.run(
      { event: 'PreToolUse', toolName: 'write', input: {} },
      'write',
    ),
  ).toEqual({ additionalContext: 'ok' })
})

test('un hook que falla avisa pero no bloquea', async () => {
  const runner = new HookRunner(
    { Stop: [{ command: 'exit 1', timeoutMs: 5000 }] },
    dir,
    () => 's',
  )
  const result = await runner.run({ event: 'Stop' })
  expect(result.decision).toBeUndefined()
  expect(result.warnings?.[0]).toContain('falló (exit 1)')
})

test('PreToolUse bloquea un comando peligroso', async () => {
  const h = harness(
    {
      PreToolUse: [
        {
          matcher: 'bash',
          command:
            'grep -q "rm -rf" && { echo "prohibido" >&2; exit 2; } || true',
        },
      ],
    },
    [
      { toolCalls: [{ name: 'bash', input: { command: 'rm -rf build' } }] },
      { text: 'vale' },
    ],
  )
  await say(h, 'borra build')
  expect(h.agent.messages[2]!.content[0]).toMatchObject({
    type: 'tool_result',
    isError: true,
    content: 'Bloqueado por un hook: prohibido',
  })
})

test('PostToolUse se ejecuta tras editar (p.ej. para formatear)', async () => {
  const h = harness(
    {
      PostToolUse: [
        {
          matcher: 'edit|write',
          command: 'echo formateado >> hooks.log; echo "archivo formateado"',
        },
      ],
    },
    [
      { toolCalls: [{ name: 'write', input: { path: 'a.ts', content: 'x' } }] },
      { text: 'listo' },
    ],
  )
  await say(h, 'crea a.ts')
  expect(await Bun.file(join(dir, 'hooks.log')).text()).toBe('formateado\n')
  expect(h.agent.messages[2]!.content[0]).toMatchObject({
    content: expect.stringContaining('archivo formateado'),
  })
})

test('UserPromptSubmit añade contexto o bloquea', async () => {
  const h = harness({
    UserPromptSubmit: [
      {
        command: `grep -q secreto && { echo "no" >&2; exit 2; } || echo "rama: main"`,
      },
    ],
  })
  await say(h, 'hola')
  expect(messageText(h.agent.messages[0]!)).toContain('rama: main')
  const events = await say(h, 'dime el secreto')
  expect(
    events.some((e) => e.type === 'notice' && e.text.includes('bloqueado')),
  ).toBe(true)
  expect(h.agent.messages).toHaveLength(2)
})

test('Stop puede pedir al agente que siga', async () => {
  const h = harness({
    Stop: [
      {
        command: `test -f done || { touch done; echo '{"decision":"block","reason":"ejecuta los tests"}'; }`,
      },
    ],
  })
  await say(h, 'haz algo')
  expect(h.agent.messages.map(messageText)).toEqual([
    'haz algo',
    'Hola, soy el mock. Has dicho: haz algo',
    'ejecuta los tests',
    'Hola, soy el mock. Has dicho: ejecuta los tests',
  ])
})
