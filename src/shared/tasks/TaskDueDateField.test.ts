import { describe, expect, it } from 'vitest'
import { clearTaskDueDatePatch } from './TaskDueDateField'

describe('clearTaskDueDatePatch', () => {
  it('clears due_date, due_at, and due_time together', () => {
    expect(clearTaskDueDatePatch()).toEqual({
      due_date: null,
      due_at: null,
      due_time: null,
    })
  })
})
