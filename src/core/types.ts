// Vocabulario interno del harness

// Datos opacos que un provider necesita recibir de vuelta en el siguiente returno
// (razonamiento cifrado de OpenAI, firma del thinking de Anthropic...)
export type ProviderData = { provider: string; data: unknown }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result'
      toolUseId: string
      content: string
      isError?: boolean
    }
  | { type: 'thinking'; text: string; providerData?: ProviderData }

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

export type Usage = {
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
}

export function newId(): string {
  return crypto.randomUUID()
}

export function userMessage(text: string): Message {
  return { id: newId(), role: 'user', content: [{ type: 'text', text }] }
}

export function messageText(message: Message): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}
