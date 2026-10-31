import { describe, expect, it } from 'vitest'
import { decideAlert, evaluateRule } from './alerts.ts'

const rule = { comparison: 'gte' as const, warn_value: 70, crit_value: 90 }
const HOUR = 3_600_000

describe('alert evaluation', () => {
  it('converts to a percentage of the plan limit', () => {
    expect(evaluateRule(rule, 750, 1000)).toMatchObject({ level: 'warning', value: 75, threshold: 70 })
    expect(evaluateRule(rule, 950, 1000)).toMatchObject({ level: 'critical', threshold: 90 })
    expect(evaluateRule(rule, 100, 1000).level).toBeNull()
  })

  it('compares raw values without a limit, in either direction', () => {
    expect(evaluateRule({ comparison: 'gte', warn_value: 1, crit_value: 10 }, 3).level).toBe('warning')
    expect(evaluateRule({ comparison: 'lte', warn_value: 20, crit_value: 5 }, 4).level).toBe('critical')
    expect(evaluateRule({ comparison: 'gte', warn_value: null, crit_value: 1 }, 0).level).toBeNull()
  })

  it('opens once, escalates, respects the cooldown and resolves', () => {
    const now = Date.now()
    const warn = evaluateRule(rule, 80, 100)
    const crit = evaluateRule(rule, 95, 100)
    const ok = evaluateRule(rule, 10, 100)
    expect(decideAlert({ cooldown_hours: 24, notify: true }, warn, null, now)).toEqual({ action: 'open', level: 'warning', notify: true })
    const open = { id: '1', rule_key: 'x', level: 'warning' as const, last_notified_at: new Date(now - HOUR).toISOString() }
    expect(decideAlert({ cooldown_hours: 24, notify: true }, warn, open, now)).toEqual({ action: 'none' })
    expect(decideAlert({ cooldown_hours: 24, notify: true }, warn, { ...open, last_notified_at: new Date(now - 25 * HOUR).toISOString() }, now)).toEqual({
      action: 'renotify',
    })
    expect(decideAlert({ cooldown_hours: 24, notify: true }, crit, open, now)).toEqual({ action: 'escalate', level: 'critical', notify: true })
    expect(decideAlert({ cooldown_hours: 24, notify: true }, ok, open, now)).toEqual({ action: 'resolve', notify: true })
    expect(decideAlert({ cooldown_hours: 24, notify: true }, ok, null, now)).toEqual({ action: 'none' })
    expect(decideAlert({ cooldown_hours: 24, notify: false }, warn, { ...open, last_notified_at: null }, now)).toEqual({ action: 'none' })
  })
})
