import type { Harness } from '../harness.ts'

export type CommandContext = {
  args: string // lo que va después de "/nombre "
  harness: Harness
  print(text: string, level?: 'info' | 'error'): void // la TUI y el headless lo pintan distinto
}

export type CommandResult =
  | { type: 'handled' } // el comando ha hecho su trabajo (p.ej. /clear)
  | { type: 'prompt'; prompt: string } // enviar este texto al agente (comandos .md)

export type Command = {
  name: string
  description: string
  argsHint?: string // "<modelo>", para el autocompletado
  source: 'builtin' | 'user' | 'project'
  run(ctx: CommandContext): Promise<CommandResult>
}
