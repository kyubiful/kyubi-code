// Lista de opciones navegable con el teclado: ↑/↓ para moverse, espacio para
// marcar (si es multiselección), Enter para confirmar y Esc para cancelar.
import { useKeyboard } from '@opentui/solid'
import { createSignal, For, Show } from 'solid-js'
import { theme } from '../theme.ts'

export type Option = { label: string; description?: string }

export function OptionList(props: {
  options: Option[]
  multiSelect?: boolean
  onConfirm: (indexes: number[]) => void
  onCancel: () => void
}) {
  const [cursor, setCursor] = createSignal(0)
  const [marked, setMarked] = createSignal<Set<number>>(new Set())

  useKeyboard((key) => {
    const count = props.options.length
    if (key.name === 'up') setCursor((c) => (c - 1 + count) % count)
    else if (key.name === 'down') setCursor((c) => (c + 1) % count)
    else if (key.name === 'space' && props.multiSelect) {
      setMarked((prev) => {
        const next = new Set(prev)
        if (next.has(cursor())) next.delete(cursor())
        else next.add(cursor())
        return next
      })
    } else if (key.name === 'return') {
      const chosen =
        props.multiSelect && marked().size ? [...marked()].sort() : [cursor()]
      props.onConfirm(chosen)
    } else if (key.name === 'escape') props.onCancel()
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column">
      <For each={props.options}>
        {(option, index) => {
          const active = () => index() === cursor()
          const mark = () =>
            props.multiSelect ? (marked().has(index()) ? '[x] ' : '[ ] ') : ''
          return (
            <box flexDirection="column">
              <text fg={active() ? theme.selected : theme.text}>
                {active() ? '❯ ' : '  '}
                {mark()}
                {option.label}
              </text>
              <Show when={option.description}>
                <text fg={theme.muted}>
                  {'    '}
                  {option.description}
                </text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
