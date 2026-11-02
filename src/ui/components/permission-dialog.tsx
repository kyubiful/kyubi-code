import type { PermissionRequest } from '../../core/permissions.ts'
import { summarizeInput } from '../store.ts'
import { theme } from '../theme.ts'
import { OptionList } from './option-list.tsx'

const answers = ['allow_once', 'allow_always', 'deny'] as const

export function PermissionDialog(props: {
  request: PermissionRequest
  onDone: () => void
}) {
  const what = () =>
    props.request.target ??
    summarizeInput(props.request.toolName, props.request.input)
  const respond = (answer: (typeof answers)[number]) => {
    props.request.respond(answer)
    props.onDone()
  }
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      borderStyle="rounded"
      borderColor={theme.warning}
      padding={1}
    >
      <text fg={theme.warning}>
        ¿Permitir {props.request.toolName}: {what()}?
      </text>
      <OptionList
        options={[
          { label: 'Sí' },
          {
            label: 'Sí, y no volver a preguntar',
            description: `${props.request.toolName}(${props.request.target ?? ''})`,
          },
          { label: 'No (Esc)' },
        ]}
        onConfirm={([index]) => respond(answers[index ?? 2]!)}
        onCancel={() => respond('deny')}
      />
    </box>
  )
}
