import type { SelectRequest } from '../../core/events'
import { theme } from '../theme'
import { OptionList } from './option-list'

export function SelectDialog(props: {
  request: SelectRequest
  onDone: () => void
}) {
  const respond = (index: number | null) => {
    props.request.respond(index)
    props.onDone()
  }

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      borderStyle="rounded"
      borderColor={theme.accent}
      padding={1}
    >
      <text fg={theme.accent}>{props.request.title} (Esc para cancelar)</text>
      <OptionList
        options={props.request.options}
        onConfirm={([index]) => respond(index ?? null)}
        onCancel={() => respond(null)}
      />
    </box>
  )
}
