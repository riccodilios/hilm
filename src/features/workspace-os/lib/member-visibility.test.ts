import { describe, expect, it } from 'vitest'
import {
  filterProjectsForMember,
  filterTasksForMember,
  memberCanSeeTask,
} from '@/features/workspace-os/lib/member-visibility'
import type { WorkspaceProject, WorkspaceTask } from '@/features/workspace-os/api'

const task = (overrides: Partial<WorkspaceTask>): WorkspaceTask =>
  ({
    id: 't1',
    assignee_id: 'u1',
    created_by: 'u2',
    project_id: 'p1',
    ...overrides,
  }) as WorkspaceTask

const project = (overrides: Partial<WorkspaceProject>): WorkspaceProject =>
  ({
    id: 'p1',
    created_by: 'owner',
    ...overrides,
  }) as WorkspaceProject

describe('member visibility', () => {
  it('owner sees all tasks', () => {
    const tasks = [task({ id: 'a', assignee_id: 'other' })]
    expect(filterTasksForMember(tasks, 'u1', 'owner')).toHaveLength(1)
  })

  it('member only sees assigned or created tasks', () => {
    const tasks = [
      task({ id: 'a', assignee_id: 'u1' }),
      task({ id: 'b', assignee_id: 'other' }),
      task({ id: 'c', assignee_id: null, created_by: 'u1' }),
    ]
    const visible = filterTasksForMember(tasks, 'u1', 'member')
    expect(visible.map((t) => t.id).sort()).toEqual(['a', 'c'])
  })

  it('filters projects to those with visible tasks', () => {
    const tasks = [task({ project_id: 'p1', assignee_id: 'u1' })]
    const projects = [project({ id: 'p1' }), project({ id: 'p2' })]
    const visible = filterProjectsForMember(projects, tasks, 'u1', 'member')
    expect(visible.map((p) => p.id)).toEqual(['p1'])
  })

  it('memberCanSeeTask respects assignee and creator', () => {
    expect(memberCanSeeTask(task({ assignee_id: 'u1' }), 'u1', 'member')).toBe(true)
    expect(memberCanSeeTask(task({ assignee_id: 'other', created_by: 'u1' }), 'u1', 'member')).toBe(
      true,
    )
    expect(memberCanSeeTask(task({ assignee_id: 'other', created_by: 'x' }), 'u1', 'member')).toBe(
      false,
    )
  })
})
