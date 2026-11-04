// Ejecuta los hooks configurados para un evento y combina sus respuestas
import type {
  HookConfig,
  HookEventName,
  HookInput,
  HookResult,
  HooksConfig,
} from './types'

export class HookRunner {
  constructor(
    private hooks: HooksConfig,
    private cwd: string,
    private sessionId: () => string,
  ) {}

  has(event: HookEventName): boolean {
    return Boolean(this.hooks[event]?.length)
  }

  // `target` es el nombre de la tool (para los matches de PreToolUse/PostToolUse)
  async run(
    input: DistributiveOmit<HookInput, 'sessionId' | 'cwd'>,
    target?: string,
  ): Promise<HookResult> {
    const configs = (this.hooks[input.event] ?? []).filter((hook) =>
      matches(hook, target),
    )
    const combined: HookResult = {}
    const payload = JSON.stringify({
      ...input,
      sessionId: this.sessionId(),
      cwd: this.cwd,
    })
    // En orden: si uno bloquea, los siguientes no se ejecutan
    for (const hook of configs) {
      const result = await this.exec(hook, payload)
      if (result.warnings)
        combined.warnings = [...(combined.warnings ?? []), ...result.warnings]
      if (result.updatedInput !== undefined)
        combined.updatedInput = result.updatedInput
      if (result.additionalContext) {
        combined.additionalContext = [
          combined.additionalContext,
          result.additionalContext,
        ]
          .filter(Boolean)
          .join('\n')
      }
      if (result.decision === 'block') {
        combined.decision = 'block'
        combined.reason = result.reason
        break
      }
    }
    return combined
  }

  private async exec(hook: HookConfig, payload: string): Promise<HookResult> {
    const proc = Bun.spawn(['bash', '-c', hook.command], {
      cwd: this.cwd,
      stdin: new Blob([payload]),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, KYUBI_PROJECT_DIR: this.cwd },
    })
    const timer = setTimeout(() => proc.kill(), hook.timeoutMs)
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      if (code === 2) {
        return {
          decision: 'block',
          reason: stderr.trim() || `Bloqueado por el hook: ${hook.command}`,
        }
      }

      if (code !== 0) {
        return {
          warnings: [
            `El hook "${hook.command}" falló (exit ${code}): ${stderr.trim()}`,
          ],
        }
      }
      return parseOutput(stdout)
    } finally {
      clearTimeout(timer)
    }
  }
}

function matches(hook: HookConfig, target: string | undefined): boolean {
  if (!hook.matcher || hook.matcher === '*' || target === undefined) return true
  return new RegExp(`^(${hook.matcher})$`).test(target)
}

function parseOutput(stdout: string): HookResult {
  const text = stdout.trim()
  if (!text) return {}
  try {
    const data = JSON.parse(text)
    if (typeof data === 'object' && data !== null) return data as HookResult
  } catch {
    // No es JSON: se toma como texto para el modelo
  }
  return { additionalContext: text }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never
