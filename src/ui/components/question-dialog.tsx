// Muestra las preguntas de la tool `question` una a una. La última opción,
// "Otro", deja escribir una respuesta libre.
import type { TextareaRenderable } from '@opentui/core'
import { createSignal, Show } from 'solid-js'
import type { QuestionAnswer, QuestionRequest } from '../../core/questions.ts'
import { theme } from '../theme.ts'
import { OptionList } from './option-list.tsx'

export function QuestionDialog(props: {
  request: QuestionRequest
  onDone: () => void
}) {
  const [index, setIndex] = createSignal(0)
  const [writing, setWriting] = createSignal(false)
  const answers: QuestionAnswer[] = []
  let input: TextareaRenderable | undefined

  const current = () => props.request.questions[index()]!
  const next = (answer: QuestionAnswer) => {
    answers.push(answer)
    setWriting(false)
    if (index() + 1 < props.request.questions.length) setIndex(index() + 1)
    else {
      props.request.respond(answers)
      props.onDone()
    }
  }
  const cancel = () => {
    props.request.respond(null)
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
      <text fg={theme.muted}>
        [{current().header}] {index() + 1}/{props.request.questions.length}
      </text>
      <text fg={theme.accent}>{current().question}</text>
      <Show
        when={writing()}
        fallback={
          <OptionList
            options={[
              ...current().options,
              { label: 'Otro (escribir respuesta)' },
            ]}
            multiSelect={current().multiSelect}
            onConfirm={(indexes) => {
              if (indexes.includes(current().options.length)) setWriting(true)
              else {
                const selected = indexes.map((i) => current().options[i]!.label)
                next({ question: current().question, selected })
              }
            }}
            onCancel={cancel}
          />
        }
      >
        <textarea
          ref={(node) => {
            input = node
          }}
          focused
          height={1}
          placeholder="Escribe tu respuesta y pulsa Enter"
          keyBindings={[{ name: 'return', action: 'submit' }]}
          onSubmit={() =>
            next({
              question: current().question,
              selected: [],
              other: input?.plainText.trim(),
            })
          }
        />
      </Show>
    </box>
  )
}
