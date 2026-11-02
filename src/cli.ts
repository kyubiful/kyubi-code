#!/usr/bin/env bun
// Entrypoint del harness. TUI por defecto, headless con -p.
import { parseArgs } from 'node:util'
import type { PermissionMode } from './core/permissions'

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    prompt: { type: 'string', short: 'p' },
    provider: { type: 'string' },
    model: { type: 'string', short: 'm' },
    mode: { type: 'string' },
    'no-interactive': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
})

if (values.help) {
  console.log(`Uso: kyubi [opciones]
        kyubi login <provider>
        kyubi logout <provider>

  -p, --prompt <prompt>  Modo headless: ejecuta el prompt e imprime la respuesta
      --provider <id>    Provider a usar (por defecto: el de la config)
  -m, --model <id>       Modelo a usar
      --mode <modo>      Modo de permisos: default, acceptEdits o plan
      --no-interactive   No preguntar permisos (lo que haya que preguntar se deniega)
  -h, --help             Muestra esta ayuda`)
  process.exit(0)
}

try {
  const [command, arg] = positionals
  if (command === 'login') {
    if (!arg) throw new Error('Uso: kyubi login <provider>')
    const { loginProvider } = await import('./providers/index')
    await loginProvider(arg)
    console.log(`Sesión iniciada en ${arg}`)
  } else if (command === 'logout') {
    if (!arg) throw new Error('Uso: kyubi logout <provider>')
    const { removeCredential } = await import('./core/auth-store')
    const removed = await removeCredential(arg)
    console.log(
      removed ? `Sesión cerrada en ${arg}` : `No había sesión en ${arg}`,
    )
  } else if (command) {
    throw new Error(`Comando desconocido: ${command}. Usa kyubi --help`)
  } else if (values.prompt !== undefined) {
    const { runHeadless } = await import('./headless.ts')
    await runHeadless({
      prompt: values.prompt,
      provider: values.provider,
      model: values.model,
      mode: parseMode(values.mode),
      interactive: !values['no-interactive'],
    })
  } else {
    // Inicia la TUI
    await import('@opentui/solid/preload')
    const { startTui } = await import('./ui/app.tsx')

    await startTui()
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

function parseMode(mode: string | undefined): PermissionMode | undefined {
  if (mode === undefined) return undefined
  if (mode === 'default' || mode === 'acceptEdits' || mode === 'plan')
    return mode
  throw new Error(`Modo desconocido: ${mode}. Usa default, acceptEdits o plan`)
}
