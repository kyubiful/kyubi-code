// Registro de comandos. Si dos comandos se llaman igual, gana el último registrado
// (así un comando del proyecto puede sustituir a uno global o integrado)
import { type Command } from './types'

export class CommandRegistry {
  private commands = new Map<string, Command>()

  constructor(commands: Command[] = []) {
    for (const command of commands) this.registered(command)
  }

  registered(command: Command): void {
    this.commands.set(command.name, command)
  }

  get(name: string): Command | undefined {
    return this.commands.get(name)
  }

  list(): Command[] {
    return [...this.commands.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }

  // Comandos que empiezan por lo que el usuario lleva escrito (para autocompletar)
  complete(prefix: string): Command[] {
    return this.list().filter((command) => command.name.startsWith(prefix))
  }
}

// "model openai/gpt-5" -> { name: 'model', args: 'openai/gpt-5' }
export function parseCommand(
  text: string,
): { name: string; args: string } | null {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim())
  return match ? { name: match[1]!, args: match[2]!.trim() } : null
}
