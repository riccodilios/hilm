import { describe, expect, it } from 'vitest'
import {
  messageLooksLikeCreate,
  messageLooksLikeEdit,
  messageLooksLikeMultiCreate,
} from '@/features/ai/lib/conversation-focus'

describe('message intent heuristics', () => {
  it('treats create + priority/title as CREATE not EDIT', () => {
    expect(messageLooksLikeCreate('Create a high priority task titled Docs')).toBe(true)
    expect(messageLooksLikeEdit('Create a high priority task titled Docs')).toBe(false)
  })

  it('treats add another / new task as CREATE', () => {
    expect(messageLooksLikeCreate('Add another task for Finora')).toBe(true)
    expect(messageLooksLikeCreate('Make a new task called Prepare proposal')).toBe(true)
    expect(messageLooksLikeEdit('Add another task for Finora')).toBe(false)
  })

  it('treats multi-create lists as multi-create', () => {
    expect(messageLooksLikeMultiCreate('Create these tasks: A, B, C')).toBe(true)
    expect(messageLooksLikeMultiCreate('Create 3 tasks for me')).toBe(true)
  })

  it('treats refinements of it/that as EDIT', () => {
    expect(messageLooksLikeEdit('Make the title shorter')).toBe(true)
    expect(messageLooksLikeEdit('Change the priority to high')).toBe(true)
    expect(messageLooksLikeCreate('Make the title shorter')).toBe(false)
  })
})
