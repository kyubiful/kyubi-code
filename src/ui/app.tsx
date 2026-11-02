// La TUI. Solo pinta el estado y llama a métodos del Harness: toda la lógica
// vive en el core, así que cualquier cosa de aquí también se puede hacer en headless.
import { SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { render, useKeyboard, useRenderer } from '@opentui/solid'
import { createSignal, For, Index, Show } from 'solid-js'
import type { Command } from '../commands/types.ts'
import type { PermissionRequest } from '../core/permissions.ts'
import type { QuestionRequest } from '../core/questions.ts'
import type { Task } from '../core/tasks.ts'
import { formatTokens } from '../core/usage.ts'
import { Harness } from '../harness.ts'
import { ChatItemView } from './components/chat-item.tsx'
import { PermissionDialog } from './components/permission-dialog.tsx'
import { QuestionDialog } from './components/question-dialog.tsx'
import { notice, reduce, type ChatItem } from './store.ts'
import { theme } from './theme.ts'
import { Logo } from './components/logo.tsx'

type Dialog =
  | { kind: 'permission'; request: PermissionRequest }
  | { kind: 'question'; request: QuestionRequest }

export function App(props: { harness: Harness; onExit: () => void }) {
  const harness = props.harness
  const renderer = useRenderer()
  const syntaxStyle = SyntaxStyle.fromStyles(
    {
      default: { fg: theme.text },
      'markup.heading': { fg: theme.accent, bold: true },
      'markup.strong': { bold: true },
      'markup.italic': { italic: true },
      'markup.raw': { fg: theme.warning },
      'markup.link': { fg: theme.accent, underline: true },
    },
    renderer.nativeScene,
  )

  const [items, setItems] = createSignal<ChatItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [dialog, setDialog] = createSignal<Dialog | null>(null)
  const [tasks, setTasks] = createSignal<Task[]>([])
  const [queued, setQueued] = createSignal<string[]>([])
  const [mode, setMode] = createSignal(harness.permissions.mode)
  const [expanded, setExpanded] = createSignal(false)
  const [usage, setUsage] = createSignal('')
  const [suggestions, setSuggestions] = createSignal<Command[]>([])

  let editor: TextareaRenderable | undefined
  let controller: AbortController | undefined

  const add = (item: ChatItem) => setItems((prev) => [...prev, item])

  async function submit() {
    const text = editor?.plainText.trim()
    if (!text) return
    editor?.setText('')
    if (busy() && text.startsWith('/')) {
      add(
        notice(
          'Espera a que termine el turno para usar comandos (o pulsa Esc)',
        ),
      )
      return
    }
    if (busy()) {
      // El agente está trabajando: el mensaje se le entrega al final del turno
      harness.enqueue(text)
      setQueued((prev) => [...prev, text])
      return
    }
    await runAgent(text)
  }

  async function runAgent(text: string) {
    setBusy(true)
    controller = new AbortController()
    try {
      for await (const event of harness.submit(text, controller.signal)) {
        setItems((prev) => reduce(prev, event))
        switch (event.type) {
          case 'permission_request':
            setDialog({ kind: 'permission', request: event.request })
            break
          case 'question_request':
            setDialog({ kind: 'question', request: event.request })
            break
          case 'tasks_updated':
            setTasks(event.tasks)
            break
          case 'cleared':
            setTasks([])
            setUsage('')
            break
          case 'usage':
            updateUsage()
            break
          case 'message_added':
            // Un mensaje en cola ya se ha entregado: se quita de la lista
            if (event.message.role === 'user') {
              const delivered = event.message.content.map((b) =>
                b.type === 'text' ? b.text : '',
              )
              setQueued((prev) => prev.filter((q) => !delivered.includes(q)))
            }
            break
        }
      }
    } catch (error) {
      add(notice(String(error), 'error'))
    } finally {
      setBusy(false)
      setDialog(null)
    }
  }

  function updateUsage() {
    const context = harness.usage.context(harness.model)
    const { total } = harness.usage
    setUsage(
      `${context.percent}% contexto · ↑${formatTokens(total.inputTokens)} ↓${formatTokens(total.outputTokens)}`,
    )
  }

  // Autocompletado: mientras escribe "/nom", se sugieren los comandos que encajan
  function updateSuggestions(text: string) {
    const match = /^\/(\S*)$/.exec(text)
    setSuggestions(
      match ? harness.commands.complete(match[1]!).slice(0, 6) : [],
    )
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      key.preventDefault()
      if (busy()) controller?.abort()
      else if (editor?.plainText.length) editor.setText('')
      else props.onExit()
    } else if (key.name === 'escape' && busy() && !dialog()) {
      key.preventDefault()
      controller?.abort()
    } else if (key.name === 'tab' && !key.shift && suggestions().length) {
      key.preventDefault()
      editor?.setText(`/${suggestions()[0]!.name}`)
      editor?.gotoBufferEnd()
      setSuggestions([])
    } else if (key.name === 'tab' && key.shift) {
      key.preventDefault()
      setMode(harness.cycleMode())
    } else if (key.ctrl && key.name === 'o') {
      key.preventDefault()
      setExpanded((value) => !value)
    }
  })

  const permissionRequest = () => {
    const d = dialog()
    return d?.kind === 'permission' ? d.request : undefined
  }
  const questionRequest = () => {
    const d = dialog()
    return d?.kind === 'question' ? d.request : undefined
  }

  const modeLabel = () =>
    mode() === 'plan'
      ? 'modo plan'
      : mode() === 'acceptEdits'
        ? 'aceptar ediciones'
        : 'modo normal'

  // La columna ocupa toda la pantalla: el scrollbox crece (flexGrow) y el resto
  // no se encoge (flexShrink={0}); si no, Yoga lo aplasta cuando falta espacio
  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <text fg={theme.accent} flexShrink={0}>
        kyubi · {harness.provider.id}/{harness.model.id} · {harness.cwd}
      </text>
      <Logo />

      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" marginTop={1}>
        <Index each={items()}>
          {(item) => (
            <ChatItemView
              item={item}
              expanded={expanded()}
              syntaxStyle={syntaxStyle}
            />
          )}
        </Index>
        <Show when={busy() && !dialog()}>
          <text fg={theme.muted}>⋯ trabajando (Esc para cancelar)</text>
        </Show>
      </scrollbox>

      <Show when={tasks().some((task) => task.status !== 'completed')}>
        <box
          flexDirection="column"
          flexShrink={0}
          borderStyle="single"
          borderColor={theme.border}
          paddingX={1}
        >
          <For each={tasks()}>
            {(task) => (
              <text
                fg={task.status === 'in_progress' ? theme.warning : theme.muted}
              >
                {task.status === 'completed'
                  ? '☒'
                  : task.status === 'in_progress'
                    ? '◼'
                    : '☐'}{' '}
                {task.subject}
              </text>
            )}
          </For>
        </box>
      </Show>

      <For each={queued()}>
        {(text) => <text fg={theme.muted}>⏳ en cola: {text}</text>}
      </For>

      {/* keyed: cada petición nueva monta un diálogo nuevo (con su estado limpio) */}
      <Show when={permissionRequest()} keyed>
        {(request: PermissionRequest) => (
          <PermissionDialog request={request} onDone={() => setDialog(null)} />
        )}
      </Show>
      <Show when={questionRequest()} keyed>
        {(request: QuestionRequest) => (
          <QuestionDialog request={request} onDone={() => setDialog(null)} />
        )}
      </Show>

      <box
        borderStyle="single"
        border={['left']}
        backgroundColor={theme.background}
        borderColor={dialog() ? theme.border : theme.accent}
        flexShrink={0}
        paddingX={2}
        paddingY={1}
      >
        <textarea
          ref={(node) => {
            editor = node
          }}
          focused={!dialog()}
          width="100%"
          minHeight={1}
          maxHeight={8}
          placeholder={
            busy() ? 'Escribe para añadir a la cola…' : 'Escribe tu mensaje…'
          }
          keyBindings={[
            { name: 'return', shift: true, action: 'newline' },
            { name: 'return', action: 'submit' },
          ]}
          onSubmit={submit}
          onContentChange={() => updateSuggestions(editor?.plainText ?? '')}
        />
      </box>

      <For each={suggestions()}>
        {(command) => (
          <text fg={theme.muted} flexShrink={0}>
            {'  '}/{command.name}
            {command.argsHint ? ` ${command.argsHint}` : ''} -{' '}
            {command.description}
          </text>
        )}
      </For>

      <box
        flexDirection="row"
        justifyContent="space-between"
        gap={2}
        flexShrink={0}
      >
        <text fg={mode() === 'default' ? theme.muted : theme.warning}>
          {modeLabel()} (shift+tab) · ctrl+o detalles · ctrl+c salir
        </text>
        <text fg={theme.muted}>{usage()}</text>
      </box>
    </box>
  )
}

export async function startTui(): Promise<void> {
  const harness = await Harness.create(process.cwd())
  let renderer: { destroy(): void } | undefined
  await render(
    () => {
      renderer = useRenderer()
      return (
        <App
          harness={harness}
          onExit={() => {
            renderer?.destroy()
            process.exit(0)
          }}
        />
      )
    },
    {
      exitOnCtrlC: false,
      exitSignals: ['SIGTERM', 'SIGHUP'],
      useKittyKeyboard: {},
    },
  )
}
