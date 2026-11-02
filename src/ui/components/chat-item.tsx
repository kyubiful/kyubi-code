// Cómo se pinta cada tipo de ChatItem
import type { SyntaxStyle } from '@opentui/core'
import { TextAttributes } from '@opentui/core'
import { Match, Show, Switch, type Accessor } from 'solid-js'
import { summarizeInput, type ChatItem } from '../store.ts'
import { theme } from '../theme.ts'

const COLLAPSED_LINES = 3

export function ChatItemView(props: {
  item: Accessor<ChatItem>
  expanded: boolean
  syntaxStyle: SyntaxStyle
}) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <Switch>
        <Match when={asKind(props.item(), 'user')}>
          {(item: Accessor<Item<'user'>>) => (
            <text fg={theme.user} attributes={TextAttributes.BOLD}>
              {'> '}
              {item().text}
            </text>
          )}
        </Match>
        <Match when={asKind(props.item(), 'assistant')}>
          {(item: Accessor<Item<'assistant'>>) => (
            <markdown
              content={item().text}
              streaming={item().streaming}
              syntaxStyle={props.syntaxStyle}
              fg={theme.text}
            />
          )}
        </Match>
        <Match when={asKind(props.item(), 'thinking')}>
          {(item: Accessor<Item<'thinking'>>) => (
            <text fg={theme.muted} attributes={TextAttributes.ITALIC}>
              ✻ {props.expanded ? item().text.trim() : firstLine(item().text)}
            </text>
          )}
        </Match>
        <Match when={asKind(props.item(), 'tool')}>
          {(item: Accessor<Item<'tool'>>) => (
            <ToolView item={item()} expanded={props.expanded} />
          )}
        </Match>
        <Match when={asKind(props.item(), 'notice')}>
          {(item: Accessor<Item<'notice'>>) => (
            <text fg={item().level === 'error' ? theme.error : theme.muted}>
              {item().level === 'error' ? '✗ ' : '· '}
              {item().text}
            </text>
          )}
        </Match>
      </Switch>
    </box>
  )
}

function ToolView(props: {
  item: Extract<ChatItem, { kind: 'tool' }>
  expanded: boolean
}) {
  const icon = () =>
    props.item.status === 'running'
      ? '⋯'
      : props.item.status === 'error'
        ? '✗'
        : '✓'
  const color = () =>
    props.item.status === 'running'
      ? theme.warning
      : props.item.status === 'error'
        ? theme.error
        : theme.success
  const result = () => {
    const lines = (props.item.result ?? '').trimEnd().split('\n')
    const max = props.expanded ? 40 : COLLAPSED_LINES
    const shown = lines.slice(0, max).join('\n')
    return lines.length > max
      ? `${shown}\n… ${lines.length - max} líneas más (ctrl+o)`
      : shown
  }
  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg={color()}>{icon()} </text>
        <text attributes={TextAttributes.BOLD}>{props.item.name} </text>
        <text fg={theme.muted}>
          {summarizeInput(props.item.name, props.item.input)}
        </text>
      </box>
      <Show when={props.item.result}>
        <box paddingLeft={2}>
          <text fg={props.item.status === 'error' ? theme.error : theme.muted}>
            {result()}
          </text>
        </box>
      </Show>
    </box>
  )
}

type Item<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

// Para <Match>: devuelve el item si es del tipo pedido (y TypeScript lo estrecha)
function asKind<K extends ChatItem['kind']>(item: ChatItem, kind: K) {
  return item.kind === kind ? (item as Item<K>) : undefined
}

function firstLine(text: string): string {
  const lines = text.trim().split('\n')
  return lines.length > 1 ? `${lines[0]} …` : (lines[0] ?? '')
}
