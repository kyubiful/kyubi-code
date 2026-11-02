// Contabilidad de tokens. El % de contexto se calcula con el inputToken del ÚLTIMO turno
// (que ya incluye todo el historial), no con la suma de todos los turnos
import type { ModelInfo } from './provider'
import type { Usage } from './types'

export type ContextUsage = { used: number; window: number; percent: number }

const empty = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
})

export class UsageTracker {
  last: Usage = empty()
  total: Usage = empty()

  add(usage: Usage): void {
    this.last = usage
    this.total = {
      inputTokens: this.total.inputTokens + usage.inputTokens,
      outputTokens: this.total.outputTokens + usage.outputTokens,
      cachedTokens: (this.total.cachedTokens ?? 0) + (usage.cachedTokens ?? 0),
    }
  }

  context(model: ModelInfo): ContextUsage {
    // Lo que ocupará el próximo turno: la entrada del último + lo que generó
    const used = this.last.inputTokens + this.last.outputTokens
    return {
      used,
      window: model.contextWindow,
      percent: Math.round((used / model.contextWindow) * 100),
    }
  }

  reset(): void {
    this.last = empty()
    this.total = empty()
  }
}

export function formatTokens(n: number): string {
  return n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)
}
