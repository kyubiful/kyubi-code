import { z } from 'zod'

export const HookEventNameSchame = z.enum([
  'PreToolUse', // antes de ejecutar una tool: puede bloquearla o cambiar su input
  'PostToolUse', // después: puede añadir información al resultado
  'UserPromptSubmit', // al enviar un mensaje: puede bloquearlo o añadir contexto
  'SessionStart', // al abrir el harness: puede añadir contexto al system prompt
  'Stop', // cuando el agente termina: puede pedirle que siga
])

export type HookEventName = z.infer<typeof HookEventNameSchame>

export const HookConfigSchema = z.object({
  matcher: z.string().optional(), // nombre de tool o regex: "edit|write", "bash", "mcp__.*"
  command: z.string(), // cuando se ejecuta con bash
  timeoutMs: z.number().int().positive().default(60_000),
})

export type HookConfig = z.infer<typeof HookConfigSchema>

// En la config { "hooks": { "PostToolUse": [{ "matcher": "edit|write", "command": "bun fmt" }]}}
export const HookSchema = z.partialRecord(
  HookEventNameSchame,
  z.array(HookConfigSchema),
)
export type HooksConfig = z.infer<typeof HookSchema>

// Lo que recibe el hook por stdin (en JSON)
type HookInputBase = { sessionId: string; cwd: string }
export type HookInput = HookInputBase &
  (
    | { event: 'PreToolUse'; toolName: string; input: unknown }
    | {
        event: 'PostToolUse'
        toolName: string
        input: unknown
        result: string
        isError: boolean
      }
    | { event: 'UserPromptSubmit'; prompt: string }
    | { event: 'SessionStart'; source: 'new' | 'resume' }
    | { event: 'Stop' }
  )

// Lo que puede responder por stdout (en JSON). Convención de exit codes:
// 0 -> ok (stdout puede traer un HookResult. Si no es JSON, se toma como additionalContext)
// 2 -> bloquear (stderr es el motivo que se le pasa al modelo)
// otro -> error del hook: se avisa, pero no bloquea nada
export type HookResult = {
  decision?: 'allow' | 'block'
  reason?: string // si bloquea: se le pasa al modelo
  updatedInput?: unknown // Solo PreToolUse
  additionalContext?: string // se añade al contexto del modelo
  warnings?: string[] // errores de hooks (los rellena el runner, no el hook)
}
