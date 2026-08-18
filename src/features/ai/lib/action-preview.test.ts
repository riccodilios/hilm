import { describe, expect, it } from 'vitest'
import {
  buildPreviewDirectory,
  describeProposedActions,
  previewHeadline,
} from '@/features/ai/lib/action-preview'

describe('describeProposedActions', () => {
  it('shows project, title, and fields for a new task', () => {
    const rows = describeProposedActions([
      {
        type: 'task.create',
        title: 'Kickoff workshop',
        projectName: 'IMED',
        priority: 'high',
        status: 'todo',
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.verb).toBe('Create task')
    expect(rows[0]?.title).toBe('Kickoff workshop')
    expect(rows[0]?.project).toBe('IMED')
    expect(rows[0]?.meta.join(' ')).toMatch(/Priority High/)
    expect(rows[0]?.meta.join(' ')).toMatch(/Status Todo/)
  })

  it('expands create_many with inherited project name', () => {
    const rows = describeProposedActions([
      {
        type: 'task.create_many',
        projectName: 'Clinical Copilot',
        items: [{ title: 'Requirements' }, { title: 'Design review', priority: 'medium' }],
      },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.project).toBe('Clinical Copilot')
    expect(rows[1]?.title).toBe('Design review')
    expect(rows[1]?.meta.join(' ')).toMatch(/Priority Medium/)
  })

  it('describes an update as a change, not a create', () => {
    const rows = describeProposedActions(
      [
        {
          type: 'task.update',
          taskId: 'IMED-24',
          priority: 'urgent',
          dueAt: '2026-08-20T10:00:00',
        },
      ],
      { focus: { lastTaskTitle: 'Write protocol' } },
    )
    expect(rows[0]?.verb).toBe('Update task')
    expect(rows[0]?.taskRef).toBe('IMED-24')
    expect(previewHeadline(rows[0]!)).toContain('Write protocol')
    expect(rows[0]?.change).toMatch(/Priority → Urgent/)
    expect(rows[0]?.change).toMatch(/Due →/)
  })

  it('describes project creation by name', () => {
    const rows = describeProposedActions([
      { type: 'project.create', name: 'IMED', description: 'Clinical workspace project' },
    ])
    expect(rows[0]?.verb).toBe('Create project')
    expect(rows[0]?.title).toBe('IMED')
    expect(rows[0]?.description).toMatch(/Clinical/)
  })

  it('resolves UUID task and project from the directory', () => {
    const directory = buildPreviewDirectory({
      taskKey: 'IMED',
      projects: [{ id: 'proj-1', name: 'IMED' }],
      people: [{ id: 'user-1', name: 'Sara' }],
      tasks: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Write protocol',
          task_number: 24,
          project_id: 'proj-1',
        },
      ],
    })
    const rows = describeProposedActions(
      [
        {
          type: 'task.update',
          taskId: '11111111-1111-4111-8111-111111111111',
          assigneeId: 'user-1',
          priority: 'high',
        },
      ],
      { directory },
    )
    expect(rows[0]?.title).toBe('Write protocol')
    expect(rows[0]?.taskRef).toBe('IMED-24')
    expect(rows[0]?.project).toBe('IMED')
    expect(rows[0]?.change).toMatch(/Assignee → Sara/)
    expect(rows[0]?.change).not.toMatch(/11111111/)
  })

  it('shows a cleared due date on schedule', () => {
    const rows = describeProposedActions([
      { type: 'task.schedule', taskId: 'IMED-9', dueAt: null },
    ], { focus: { lastTaskTitle: 'Lab booking' } })
    expect(rows[0]?.verb).toBe('Reschedule task')
    expect(rows[0]?.title).toBe('Lab booking')
    expect(rows[0]?.change).toMatch(/Due → Cleared/)
  })
})
