import { describe, expect, it } from 'vitest'
import { createTaskOnce, isUniqueViolation } from './task-dedupe'

/** In-memory stand-in for tasks + the unique partial index on source_action_item_id. */
function fakeTaskTable() {
  const bySource = new Map<string, string>()
  let seq = 0
  return {
    count: () => bySource.size,
    find: async (source: string) => bySource.get(source) ?? null,
    insert: async (source: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      if (bySource.has(source)) throw Object.assign(new Error('duplicate key'), { code: '23505' })
      const id = `task-${++seq}`
      bySource.set(source, id)
      return id
    },
  }
}

describe('createTaskOnce', () => {
  it('creates a task the first time and reuses it afterwards', async () => {
    const table = fakeTaskTable()
    const run = () => createTaskOnce({ findExisting: () => table.find('ai-1'), create: () => table.insert('ai-1') })
    expect(await run()).toEqual({ taskId: 'task-1', existed: false })
    expect(await run()).toEqual({ taskId: 'task-1', existed: true })
    expect(table.count()).toBe(1)
  })

  it('resolves concurrent creates (double click / two tabs) to a single task', async () => {
    const table = fakeTaskTable()
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createTaskOnce({ findExisting: () => table.find('ai-2'), create: () => table.insert('ai-2') }),
      ),
    )
    expect(table.count()).toBe(1)
    expect(new Set(results.map((r) => r.taskId)).size).toBe(1)
    expect(results.filter((r) => !r.existed)).toHaveLength(1)
  })

  it('rethrows non-duplicate errors', async () => {
    await expect(
      createTaskOnce({
        findExisting: async () => null,
        create: async () => {
          throw Object.assign(new Error('permission denied'), { code: '42501' })
        },
      }),
    ).rejects.toThrow('permission denied')
  })

  it('rethrows a duplicate error when the existing task is not visible', async () => {
    await expect(
      createTaskOnce({
        findExisting: async () => null,
        create: async () => {
          throw Object.assign(new Error('duplicate key'), { code: '23505' })
        },
      }),
    ).rejects.toThrow('duplicate key')
  })

  it('detects Postgres unique violations only', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
