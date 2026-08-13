import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  normalizePriority,
  normalizeTaskStatus,
  optionalTaskStatus,
  taskCreateFieldsSchema,
} from '@/features/ai/registry/schemas'

describe('normalizeTaskStatus', () => {
  it('maps common LLM aliases to canonical statuses', () => {
    expect(normalizeTaskStatus('Completed')).toBe('done')
    expect(normalizeTaskStatus('in progress')).toBe('in_progress')
    expect(normalizeTaskStatus('To-Do')).toBe('todo')
    expect(normalizeTaskStatus('DONE')).toBe('done')
    expect(normalizeTaskStatus('qa')).toBe('testing')
  })

  it('returns undefined for empty / unknown', () => {
    expect(normalizeTaskStatus('')).toBeUndefined()
    expect(normalizeTaskStatus(null)).toBeUndefined()
    expect(normalizeTaskStatus('cancelled')).toBeUndefined()
  })
})

describe('optionalTaskStatus schema', () => {
  it('accepts aliases', () => {
    expect(optionalTaskStatus.parse('Completed')).toBe('done')
    expect(optionalTaskStatus.parse('In Progress')).toBe('in_progress')
  })

  it('omits empty', () => {
    expect(optionalTaskStatus.parse('')).toBeUndefined()
    expect(optionalTaskStatus.parse(undefined)).toBeUndefined()
  })

  it('rejects unknown non-empty statuses', () => {
    expect(() => optionalTaskStatus.parse('cancelled')).toThrow()
  })
})

describe('taskCreateFieldsSchema', () => {
  it('accepts create_many item shapes with aliased statuses', () => {
    const parsed = taskCreateFieldsSchema.parse({
      title: 'Reconcile invoices',
      status: 'Completed',
      priority: 'High',
    })
    expect(parsed.status).toBe('done')
    expect(parsed.priority).toBe('high')
  })
})

describe('create_many gate vs per-item', () => {
  it('allows a batch where one item has invalid status when gated loosely', () => {
    const gate = z.object({
      type: z.literal('task.create_many'),
      items: z.array(z.record(z.string(), z.unknown())).min(1),
    })
    const action = {
      type: 'task.create_many' as const,
      items: [
        { title: 'A', status: 'todo' },
        { title: 'B', status: 'not-a-real-status' },
        { title: 'C', status: 'Completed' },
      ],
    }
    expect(gate.parse(action).items).toHaveLength(3)
    const results = action.items.map((item) => taskCreateFieldsSchema.safeParse(item))
    expect(results[0]?.success).toBe(true)
    expect(results[1]?.success).toBe(false)
    expect(results[2]?.success).toBe(true)
    expect(results[2]?.success && results[2].data.status).toBe('done')
  })
})

describe('normalizePriority', () => {
  it('maps aliases', () => {
    expect(normalizePriority('High')).toBe('high')
    expect(normalizePriority('critical')).toBe('urgent')
  })
})
