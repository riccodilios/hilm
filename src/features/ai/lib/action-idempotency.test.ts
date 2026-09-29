import { describe, expect, it } from 'vitest'
import {
  buildCreateClientKey,
  recallActionResult,
  rememberActionResult,
} from '@/features/ai/lib/action-idempotency'

describe('action idempotency', () => {
  it('returns the same result for the same clientKey', () => {
    const key = buildCreateClientKey({
      title: 'Prepare report',
      projectId: 'proj-1',
      explicit: 'test-key-1',
    })
    rememberActionResult('personal:user-1', key, {
      ok: true,
      summary: 'Created “Prepare report”',
      verified: true,
      entities: [{ type: 'task', id: 'task-1' }],
    })
    const recalled = recallActionResult('personal:user-1', key)
    expect(recalled?.entities?.[0]?.id).toBe('task-1')
    expect(recalled?.ok).toBe(true)
  })

  it('builds stable keys from title + project + index', () => {
    const a = buildCreateClientKey({ title: 'A', projectId: 'p', index: 0 })
    const b = buildCreateClientKey({ title: 'A', projectId: 'p', index: 0 })
    const c = buildCreateClientKey({ title: 'A', projectId: 'p', index: 1 })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
