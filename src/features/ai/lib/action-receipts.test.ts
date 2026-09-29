import { describe, expect, it } from 'vitest'
import {
  countAuthoritativeSuccesses,
  receiptFromResult,
  summarizeBatchOutcome,
} from '@/features/ai/lib/action-receipts'

describe('action receipts', () => {
  it('builds a success receipt with entity id', () => {
    const receipt = receiptFromResult('task.create', {
      ok: true,
      summary: 'Created “X”',
      verified: true,
      entities: [{ type: 'task', id: 'abc' }],
      data: { title: 'X' },
    })
    expect(receipt.success).toBe(true)
    expect(receipt.entityId).toBe('abc')
    expect(receipt.verified).toBe(true)
  })

  it('builds a failure receipt without inventing success', () => {
    const receipt = receiptFromResult('task.create', {
      ok: false,
      summary: 'Create your first project before adding tasks.',
      code: 'project_missing',
    })
    expect(receipt.success).toBe(false)
    expect(receipt.error?.message).toMatch(/first project/i)
  })

  it('counts partial batch results accurately', () => {
    const counts = countAuthoritativeSuccesses([
      {
        success: true,
        data: {
          items: [
            { ok: true, title: 'A' },
            { ok: false, title: 'B' },
            { ok: true, title: 'C' },
          ],
        },
      },
    ])
    expect(counts.createdOrMutated).toBe(2)
    expect(counts.failed).toBe(1)
    expect(summarizeBatchOutcome({ ...counts, verb: 'created' })).toMatch(/2 succeeded/)
    expect(summarizeBatchOutcome({ ...counts, verb: 'created' })).toMatch(/1 failed/)
  })

  it('does not treat reused as a fresh create', () => {
    const counts = countAuthoritativeSuccesses([
      { success: true, data: { reused: true, title: 'X' } },
    ])
    expect(counts.createdOrMutated).toBe(0)
    expect(counts.reused).toBe(1)
  })
})
