import { afterEach, expect, test } from 'bun:test'
import { testRender } from '@opentui/solid'
import { ConfigSchema } from '../core/config.ts'
import { Harness } from '../harness.ts'
import { MockProvider, type MockScript } from '../providers/mock.ts'
import { App } from './app.tsx'

type Setup = Awaited<ReturnType<typeof testRender>>
let setup: Setup | undefined
afterEach(async () => {
  await setup?.dispose()
  setup = undefined
})

async function start(script?: MockScript) {
  const harness = new Harness({
    config: ConfigSchema.parse({ provider: 'mock' }),
    cwd: process.cwd(),
    provider: new MockProvider(script),
  })
  setup = await testRender(() => <App harness={harness} onExit={() => {}} />, {
    width: 80,
    height: 60,
  })
  await setup.renderOnce()
  return setup
}

// Espera a que el texto aparezca en pantalla (la respuesta llega en streaming)
async function waitFor(t: Setup, text: string) {
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(20)
    await t.renderOnce()
    if (t.captureCharFrame().includes(text)) return t.captureCharFrame()
  }
  throw new Error(`No apareció "${text}":\n${t.captureCharFrame()}`)
}

async function send(t: Setup, text: string) {
  await t.mockInput.typeText(text)
  t.mockInput.pressEnter()
}

test('envía un mensaje y muestra la respuesta y las tools', async () => {
  const t = await start()
  await send(t, 'echo: hola tui')
  const frame = await waitFor(t, 'La tool devolvió: hola tui')
  expect(frame).toContain('> echo: hola tui')
  expect(frame).toContain('✓ echo')
})

test('pide permiso y ejecuta la tool al aceptar', async () => {
  const t = await start([
    { toolCalls: [{ name: 'bash', input: { command: 'echo desde-bash' } }] },
    { text: 'comando ejecutado' },
  ])
  await send(t, 'ejecuta algo')
  await waitFor(t, '¿Permitir bash: echo desde-bash?')
  t.mockInput.pressEnter() // "Sí" es la primera opción
  const frame = await waitFor(t, 'comando ejecutado')
  expect(frame).toContain('desde-bash')
})

test('responde a una pregunta con las flechas', async () => {
  const question = {
    question: '¿Qué framework?',
    header: 'Tests',
    options: [{ label: 'bun' }, { label: 'vitest' }],
  }
  const t = await start([
    { toolCalls: [{ name: 'question', input: { questions: [question] } }] },
    { text: 'listo' },
  ])
  await send(t, 'añade tests')
  await waitFor(t, '❯ bun')
  t.mockInput.pressArrow('down')
  await waitFor(t, '❯ vitest')
  t.mockInput.pressEnter()
  // El resultado de la tool muestra la respuesta elegida
  const frame = await waitFor(t, 'listo')
  expect(frame).toContain('"¿Qué framework?" → vitest')
})

test('shift+tab cambia el modo de permisos', async () => {
  const t = await start()
  t.mockInput.pressTab({ shift: true })
  expect(await waitFor(t, 'aceptar ediciones')).toContain('aceptar ediciones')
})

test('autocompleta comandos con tab', async () => {
  const t = await start()
  await t.mockInput.typeText('/hel')
  await waitFor(t, '/help - Lista los comandos')
  t.mockInput.pressTab()
  t.mockInput.pressEnter()
  await waitFor(t, '/clear - Empieza una conversación nueva')
})
