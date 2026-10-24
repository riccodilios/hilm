import { describe, expect, it } from 'vitest'
import { RECORDING_LIMIT_WARNING_MS, recordingLimitMs } from './limits'

const MIN = 60_000
// Tier values after migration 0035 (every plan allows 8-hour meetings).
const free = { maxMinutes: 480, minutesPerMonth: 300, usedMinutesMonth: 0 }

describe('recordingLimitMs', () => {
  it('no longer stops a free-plan meeting at one hour', () => {
    const limit = recordingLimitMs(free, 0)!
    expect(limit).toBeGreaterThan(75 * MIN + 57_000)
    expect(limit).toBeGreaterThanOrEqual(200 * MIN)
  })

  it('still stops when the monthly minutes run out, counting from where this session starts', () => {
    const quota = { ...free, usedMinutesMonth: 250 }
    expect(recordingLimitMs(quota, 0)).toBe(50 * MIN)
    expect(recordingLimitMs(quota, 30 * MIN)).toBe(80 * MIN)
  })

  it('caps a single meeting at the plan maximum', () => {
    expect(recordingLimitMs({ maxMinutes: 480, minutesPerMonth: 10_000, usedMinutesMonth: 0 }, 0)).toBe(480 * MIN)
  })

  it('is unknown until the quota has loaded', () => {
    expect(recordingLimitMs(null, 0)).toBeNull()
  })

  it('warns five minutes before the limit', () => {
    expect(RECORDING_LIMIT_WARNING_MS).toBe(5 * MIN)
  })
})
