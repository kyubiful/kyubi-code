// Comandos que vienen con el harness. Los pasos siguientes añaden más
import { configPaths } from '../core/config'
import type { PermissionMode } from '../core/permissions'
import { messageText } from '../core/types.ts'
import { providerIds } from '../providers'
import { listSessionFiles, SessionStore } from '../session/store.ts'
import type { Command } from './types'

const handled = { type: 'handled' } as const

export function builtinCommands(): Command[] {
  return [
    {
      name: 'help',
      description: 'Lista los comandos disponibles',
      source: 'builtin',
      async run({ harness, print }) {
        const lines = harness.commands.list().map((command) => {
          const args = command.argsHint ? ` ${command.argsHint}` : ''
          const source =
            command.source === 'builtin' ? '' : ` (${command.source})`
          return `/${command.name}${args} - ${command.description}${source}`
        })
        print(lines.join('\n'))
        return handled
      },
    },
    {
      name: 'clear',
      description: 'Empieza una conversación nueva',
      source: 'builtin',
      async run({ harness, print }) {
        harness.clear()
        print('Conversación nueva')
        return handled
      },
    },
    {
      name: 'model',
      description: 'Muestra o cambia el modelo (provider/modelo o modelo)',
      argsHint: '[provider/modelo]',
      source: 'builtin',
      async run({ args, harness, print }) {
        if (!args) {
          const models = harness.provider
            .models()
            .map(
              (m) =>
                `${m.id === harness.model.id ? '❯' : ' '} ${m.id} — ${m.name}`,
            )
          print(
            `Modelo actual: ${harness.provider.id}/${harness.model.id}\n\n${models.join('\n')}\n\nProviders: ${providerIds.join(', ')}`,
          )
          return handled
        }
        harness.switchModel(args)
        print(`Modelo: ${harness.provider.id}/${harness.model.id}`)
        return handled
      },
    },
    {
      name: 'mode',
      description: 'Cambia el modo de permisos',
      argsHint: '<default|acceptEdits|plan>',
      source: 'builtin',
      async run({ args, harness, print }) {
        const modes: PermissionMode[] = ['default', 'acceptEdits', 'plan']
        if (!modes.includes(args as PermissionMode)) {
          print(
            `Modo actual: ${harness.permissions.mode}. Opciones: ${modes.join(', ')}`,
          )
          return handled
        }
        harness.permissions.mode = args as PermissionMode
        print(`Modo: ${args}`)
        return handled
      },
    },
    {
      name: 'permissions',
      description: 'Muestra las reglas de permisos',
      source: 'builtin',
      async run({ harness, print }) {
        const { allow, ask, deny } = harness.config.permissions
        const list = (rules: string[]) =>
          rules.length ? rules.join(', ') : '(ninguna)'
        print(
          `Modo: ${harness.permissions.mode}\nallow: ${list(allow)}\nask: ${list(ask)}\ndeny: ${list(deny)}\n\nLas reglas de "permitir siempre" se guardan en ${configPaths(harness.cwd).local}`,
        )
        return handled
      },
    },
    {
      name: 'config',
      description: 'Muestra la configuración efectiva y de dónde se carga',
      source: 'builtin',
      async run({ harness, print }) {
        const paths = configPaths(harness.cwd)
        print(
          `Archivos (de menor a mayor prioridad):\n  ${paths.user}\n  ${paths.project}\n  ${paths.local}\n\n${JSON.stringify(harness.config, null, 2)}`,
        )
        return handled
      },
    },
    {
      name: 'login',
      description: 'Inicia sesión en un provider',
      argsHint: '<provider>',
      source: 'builtin',
      async run({ args, print }) {
        if (!args) {
          print('Uso: /login <provider>', 'error')
          return handled
        }
        const { loginProvider } = await import('../providers/index.ts')
        await loginProvider(args, print)
        print(`Sesión iniciada en ${args}`)
        return handled
      },
    },
    {
      name: 'resume',
      description: 'Retoma una sesión anterior (sin id, lista las recientes)',
      argsHint: '[id]',
      source: 'builtin',
      async run({ args, harness, print }) {
        if (args) {
          harness.loadSession(await SessionStore.find(harness.cwd, args))
          print(`Sesión ${harness.session.id.slice(0, 8)} retomada`)
          return handled
        }
        const files = (await listSessionFiles(harness.cwd)).slice(0, 10)
        if (!files.length) {
          print('No hay sesiones guardadas en este proyecto')
          return handled
        }
        const lines = await Promise.all(
          files.map(async (file) => {
            const first = (await SessionStore.open(file.path)).messages()[0]
            const preview = first ? messageText(first).slice(0, 60) : '(vacía)'
            return `${file.id.slice(0, 8)} ${file.mtime.toLocaleString()} ${preview}`
          }),
        )
        print(
          `${lines.join('\n')}\n\nUsa /resume <id> (vale el comienzo del id)`,
        )
        return handled
      },
    },
    {
      name: 'tasks',
      description: 'Muestra la lista de tareas',
      source: 'builtin',
      async run({ harness, print }) {
        print(harness.tasks.format())
        return handled
      },
    },
  ]
}
