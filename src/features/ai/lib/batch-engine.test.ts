import { describe, expect, it } from 'vitest'
import { parseActionsFromAssistantContent, repairJsonActionsArray } from '@/features/ai/lib/actions-parse'
import { coalesceWorkspaceTaskCreates } from '@/features/ai/lib/batch-engine'

describe('actions-parse', () => {
  it('recovers truncated actions array', () => {
    const raw = `[
  {"type":"task.create","title":"One"},
  {"type":"task.create","title":"Two"},
  {"type":"task.create","title":"Thr`
    const repaired = repairJsonActionsArray(raw)
    expect(repaired?.length).toBe(2)
    expect((repaired?.[0] as { title: string }).title).toBe('One')
  })

  it('parses unclosed actions fence', () => {
    const content = `Sure.\n\`\`\`actions\n[{"type":"task.create_many","projectName":"Finance","items":[{"title":"A"},{"title":"B"}]}]`
    const parsed = parseActionsFromAssistantContent(content)
    expect(parsed.actions.length).toBe(1)
    expect(parsed.truncated).toBe(true)
  })
})

describe('batch-engine', () => {
  it('coalesces many workspace creates into create_many', () => {
    const actions = Array.from({ length: 12 }, (_, i) => ({
      type: 'task.create',
      title: `Task ${i + 1}`,
      projectName: 'Finance',
    }))
    const next = coalesceWorkspaceTaskCreates(actions)
    expect(next).toHaveLength(1)
    expect(next[0]?.type).toBe('task.create_many')
    expect(Array.isArray(next[0]?.items) && next[0].items).toHaveLength(12)
  })

  it('leaves small create lists alone', () => {
    const actions = [
      { type: 'task.create', title: 'A' },
      { type: 'task.create', title: 'B' },
    ]
    expect(coalesceWorkspaceTaskCreates(actions)).toEqual(actions)
  })
})
