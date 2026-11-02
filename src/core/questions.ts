// Tipos de las preguntas que el modelo puede hacer al usuario (tool `question`)
export type Question = {
  question: string // "¿Qué librería de tests uso?"
  header: string // etiqueta corta para la UI
  options: { label: string; description?: string }[] // 2-4 opciones
  multiSelect?: boolean
}

export type QuestionAnswer = {
  question: string
  selected: string[] // labels elegidos
  other?: string // texto libre si eligió "Otro"
}

export type QuestionRequest = {
  requestId: string
  questions: Question[]
  respond(answers: QuestionAnswer[] | null): void // null = cancelada
}
