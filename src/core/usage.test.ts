import { expect, test } from 'bun:test'
import { formatTokens, UsageTracker } from './usage'

const model = {
  id: 'm',
  name: 'm',
  contextWindow: 10_000,
  maxOutputTokens: 1_000,
}

test('acumula el total y recuerda el último turno', () => {
  const usage = new UsageTracker()
  usage.add({ inputTokens: 1_000, outputTokens: 100, cachedTokens: 0 })
  usage.add({ inputTokens: 1_200, outputTokens: 50, cachedTokens: 1_000 })
  expect(usage.total).toEqual({
    inputTokens: 2_200,
    outputTokens: 150,
    cachedTokens: 1_000,
  })
  expect(usage.last.inputTokens).toBe(1_200)
})

test('el % de contexto usa sólo el último turno', () => {
  const usage = new UsageTracker()
  usage.add({ inputTokens: 4_000, outputTokens: 0 })
  usage.add({ inputTokens: 4_500, outputTokens: 500 })
  expect(usage.context(model)).toEqual({
    used: 5_000,
    window: 10_000,
    percent: 50,
  })
})

test('formatTokens', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(12_345)).toBe('12.3k')
})
