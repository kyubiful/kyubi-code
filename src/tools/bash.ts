import { z } from 'zod'
import { defineTool, truncate, type ToolContext } from '../core/tools'

export const bashTool = defineTool({
  name: 'bash',
  description: `Ejecuta un comando en bash y devuelve su salida (stdout y stderr juntos).
- Cada llamada es un proceso nuevo en el directorio de trabajo: "cd" no persiste entre llamadas.
- No uses comandos interactivos (editores, prompts): no hay terminal.
- Para leer, buscar o editar archivos usa read, grep, glob y edit en vez de cat, grep o sed.`,
  schema: z.object({
    command: z.string().describe('Comando a ejecutar'),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .default(120_000)
      .describe('Tiempo máximo en milisegundos'),
  }),
  readOnly: false,
  permissionTarget: (input) => input.command,
  execute: async (input, ctx) => await executeBash(input, ctx),
})

async function executeBash(
  { command, timeoutMs }: { command: string; timeoutMs: number },
  ctx: ToolContext,
): Promise<string> {
  // `exec 2>&1` junta stderr con stdout para conservar el orden real de la salida
  const proc = Bun.spawn(['bash', '-c', `exec 2>&1\n${command}`], {
    cwd: ctx.cwd,
    stdout: 'pipe',
    stdin: 'ignore',
  })

  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)
  const onAbort = () => proc.kill()
  ctx.signal.addEventListener('abort', onAbort, { once: true })

  try {
    const [output, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])
    let result = truncate(output.trimEnd())
    if (timedOut) result += `\n[cancelado: superó ${timeoutMs}ms`
    else if (ctx.signal.aborted) result += '\n[cancelado por el usuario]'
    else if (exitCode !== 0) result += `\n[exit code ${exitCode}]`
    return result || '(sin salida)'
  } finally {
    clearTimeout(timer)
    ctx.signal.removeEventListener('abort', onAbort)
  }
}
