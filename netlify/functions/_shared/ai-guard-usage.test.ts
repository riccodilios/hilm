import { describe, expect, it } from 'vitest'
import { addUsage, tokensFromOpenRouterUsage } from './ai-guard'

describe('provider usage parsing', () => {
  it('keeps raw prompt/completion totals and reads audio, cached and cost details', () => {
    const usage = tokensFromOpenRouterUsage({
      prompt_tokens: 3230,
      completion_tokens: 1758,
      total_tokens: 4988,
      cost: 0.006939,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 2250 },
    })
    expect(usage).toEqual({
      inputTokens: 3230,
      outputTokens: 1758,
      totalTokens: 4988,
      cachedTokens: 0,
      audioTokens: 2250,
      costUsd: 0.006939,
    })
  })

  it('reports cost as unknown instead of zero when the provider omits it', () => {
    const usage = tokensFromOpenRouterUsage({ prompt_tokens: 10, completion_tokens: 5 })
    expect(usage.totalTokens).toBe(15)
    expect(usage.costUsd).toBeNull()
    expect(tokensFromOpenRouterUsage({ prompt_tokens: 1, cost: -1 }).costUsd).toBeNull()
  })

  it('adds usage across split/retry calls without losing audio or cost', () => {
    const a = tokensFromOpenRouterUsage({ prompt_tokens: 100, completion_tokens: 10, cost: 0.001, prompt_tokens_details: { audio_tokens: 75 } })
    const b = tokensFromOpenRouterUsage({ prompt_tokens: 50, completion_tokens: 5, cost: 0.0005, prompt_tokens_details: { audio_tokens: 25, cached_tokens: 4 } })
    const sum = addUsage(a, b)
    expect(sum).toMatchObject({ inputTokens: 150, outputTokens: 15, totalTokens: 165, audioTokens: 100, cachedTokens: 4 })
    expect(sum.costUsd).toBeCloseTo(0.0015, 10)
    expect(addUsage(a, tokensFromOpenRouterUsage({ prompt_tokens: 1 })).costUsd).toBeNull()
  })
})
