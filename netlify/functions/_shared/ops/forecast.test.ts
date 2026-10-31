import { describe, expect, it } from 'vitest'
import { FREE_LIMITS, daysUntilLimit, forecastMatrix, forecastRow, ORG_COUNTS } from './forecast.ts'

describe('capacity forecast', () => {
  it('covers 5–100 organizations under low, medium and high usage', () => {
    const rows = forecastMatrix()
    expect(rows).toHaveLength(ORG_COUNTS.length * 3)
    expect(new Set(rows.map((r) => r.orgs))).toEqual(new Set([5, 10, 15, 25, 50, 100]))
  })

  it('grows with organizations and usage', () => {
    const small = forecastRow(5, 'medium')
    const large = forecastRow(50, 'medium')
    expect(large.storageBytes).toBeGreaterThan(small.storageBytes)
    expect(large.invocationsMonth).toBeGreaterThan(small.invocationsMonth)
    expect(forecastRow(10, 'high').aiUsdMonth).toBeGreaterThan(forecastRow(10, 'low').aiUsdMonth)
  })

  it('lifecycle retention keeps storage far below keeping everything', () => {
    const row = forecastRow(25, 'medium', { audioBytesPerHour: 115 * 1024 ** 2 })
    expect(row.storageBytes).toBeLessThan(row.storageBytesWithoutLifecycle / 5)
  })

  it('uses the measured audio size when available', () => {
    const measured = forecastRow(10, 'medium', { audioBytesPerHour: 115 * 1024 ** 2, audioRetentionDays: 30 })
    const assumed = forecastRow(10, 'medium', { audioRetentionDays: 30 })
    expect(measured.storageBytes).toBeGreaterThan(assumed.storageBytes)
  })

  it('flags exceeded free-plan limits and recommends (never buys) upgrades', () => {
    const row = forecastRow(100, 'high')
    expect(row.exceeds).toContain('invocations')
    expect(row.recommendations.join(' ')).toMatch(/Supabase Pro|Netlify|Resend/)
    const tiny = forecastRow(5, 'low', {}, { ...FREE_LIMITS, invocations: 10_000_000, egressBytes: 1024 ** 4 })
    expect(tiny.exceeds).not.toContain('invocations')
  })

  it('days to limit', () => {
    expect(daysUntilLimit(500, 50, 1000)).toBe(10)
    expect(daysUntilLimit(1000, 50, 1000)).toBe(0)
    expect(daysUntilLimit(500, 0, 1000)).toBeNull()
    expect(daysUntilLimit(500, -5, 1000)).toBeNull()
  })
})
