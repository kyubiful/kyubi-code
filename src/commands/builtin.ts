// Comandos que vienen con el harness. Los pasos siguientes añaden más.
import { configPaths } from '../core/config'
import type { PermissionMode } from '../core/permissions'
import { messageText } from '../core/types'
import { providerIds } from '../providers/index'
import { resolve } from 'node:path'
import { checkpointsAfter, type RewindMode } from '../session/checkpoints'
import { deleteSession, exportMarkdown, listSessions } from '../session/manager'
import { SessionStore } from '../session/store'
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
                `${m.id === harness.model.id ? '❯' : ' '} ${m.id} - ${m.name}`,
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
      description: 'Retoma una sesión anterior',
      argsHint: '[id]',
      source: 'builtin',
      async run({ args, harness, print, select }) {
        let id = args
        if (!id) {
          const sessions = (await listSessions(harness.cwd)).filter(
            (s) => s.id !== harness.session.id,
          )
          if (!sessions.length) {
            print('No hay otras sesiones en este proyecto')
            return handled
          }
          const index = await select(
            'Retomar sesión',
            sessions.slice(0, 20).map((session) => ({
              label: session.title,
              description: `${session.id.slice(0, 8)} · ${new Date(session.updatedAt).toLocaleString()} · ${session.messageCount} mensajes`,
            })),
          )
          if (index === null) return handled
          id = sessions[index]!.id
        }
        harness.loadSession(await SessionStore.find(harness.cwd, id))
        print(`Sesión retomada: ${harness.session.title ?? harness.session.id}`)
        return handled
      },
    },
    {
      name: 'rename',
      description: 'Cambia el título de la sesión',
      argsHint: '<título>',
      source: 'builtin',
      async run({ args, harness, print }) {
        if (!args) {
          print('Uso: /rename <título>', 'error')
          return handled
        }
        harness.rename(args)
        print(`Sesión renombrada: ${args}`)
        return handled
      },
    },
    {
      name: 'delete',
      description: 'Borra una sesión guardada (sin id, la actual)',
      argsHint: '[id]',
      source: 'builtin',
      async run({ args, harness, print }) {
        const id = await deleteSession(
          harness.cwd,
          args || harness.session.id,
        ).catch(() => null)
        if (!args || id === harness.session.id) harness.clear()
        print(
          id ? `Sesión ${id.slice(0, 8)} borrada` : 'No había nada que borrar',
        )
        return handled
      },
    },
    {
      name: 'fork',
      description: 'Copia la conversación a una sesión nueva y sigue en ella',
      source: 'builtin',
      async run({ harness, print }) {
        const original = harness.session.id
        harness.fork()
        print(
          `Nueva sesión ${harness.session.id.slice(0, 8)} (copia de ${original.slice(0, 8)})`,
        )
        return handled
      },
    },
    {
      name: 'rewind',
      description:
        'Vuelve a un mensaje anterior (y opcionalmente deshace los cambios de archivos)',
      source: 'builtin',
      async run({ harness, print, select }) {
        // Mensajes escritos por el usuario en la rama activa, del más reciente al más antiguo
        const branch = harness.session.branch()
        const prompts = branch
          .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []))
          .filter(
            (m) =>
              m.role === 'user' && m.content.some((b) => b.type === 'text'),
          )
          .reverse()
        if (!prompts.length) {
          print('No hay mensajes a los que volver')
          return handled
        }
        const index = await select(
          'Volver a antes de este mensaje',
          prompts
            .slice(0, 20)
            .map((m) => ({ label: messageText(m).slice(0, 70) })),
        )
        if (index === null) return handled
        const target = prompts[index]!

        let mode: RewindMode = 'conversation'
        const changes = checkpointsAfter(branch, target.id)
        if (changes.length) {
          const modes: RewindMode[] = ['both', 'conversation', 'code']
          const choice = await select('¿Qué quieres deshacer?', [
            {
              label: 'Conversación y código',
              description: `${changes.length} cambio/s de archivos`,
            },
            {
              label: 'Solo la conversación',
              description: 'los archivos se quedan como están',
            },
            {
              label: 'Solo el código',
              description: 'la conversación sigue igual',
            },
          ])
          if (choice === null) return handled
          mode = modes[choice]!
        }
        const { restored, text } = await harness.rewind(target.id, mode)
        if (restored.length) {
          print(
            `Archivos restaurados:\n${restored.map((path) => `  ${path}`).join('\n')}`,
          )
          print(
            'Ojo: lo que hiciera bash (rm, mv, instalar paquetes...) no se puede deshacer',
          )
        }
        if (mode !== 'code') print(`Has vuelto a antes de: "${text}"`)
        return handled
      },
    },
    {
      name: 'export',
      description: 'Guarda la conversación como Markdown',
      argsHint: '[archivo]',
      source: 'builtin',
      async run({ args, harness, print }) {
        const path = resolve(
          harness.cwd,
          args || `kyubi-${harness.session.id.slice(0, 8)}.md`,
        )
        await Bun.write(path, exportMarkdown(harness.session))
        print(`Exportado a ${path}`)
        return handled
      },
    },
    {
      name: 'compact',
      description: 'Resume la conversación para liberar contexto',
      argsHint: '[instrucciones]',
      source: 'builtin',
      async run({ args, harness, print }) {
        print('Compactando...')
        const done = await harness.compact(args || undefined)
        print(
          done
            ? 'Conversación compactada'
            : 'No hay suficiente conversación que compactar',
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
