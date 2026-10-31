import { describe, expect, it } from 'vitest'
import {
  buildTaskVisibilityScope,
  canSeeMemberWork,
  canSeeWorkspaceTask,
  filterProjectsForScope,
} from '@/features/workspace-os/lib/member-visibility'
import type { WorkspaceProject, WorkspaceTask } from '@/features/workspace-os/api'
import type { WorkspaceDepartment } from '@/features/workspace-os/org-api'

const task = (overrides: Partial<WorkspaceTask>): WorkspaceTask =>
  ({
    id: 't1',
    assignee_id: 'u1',
    created_by: 'u2',
    project_id: 'p1',
    department_id: null,
    team_id: null,
    ...overrides,
  }) as WorkspaceTask

const project = (overrides: Partial<WorkspaceProject>): WorkspaceProject =>
  ({ id: 'p1', created_by: 'owner', team_id: null, ...overrides }) as WorkspaceProject

const dept = (id: string, overrides: Partial<WorkspaceDepartment> = {}): WorkspaceDepartment =>
  ({ id, name: id, parent_id: null, head_user_id: null, ...overrides }) as WorkspaceDepartment

const departments = [
  dept('hr', { head_user_id: 'head' }),
  dept('hr-payroll', { parent_id: 'hr' }),
  dept('eng'),
]
const teams = [{ id: 'team-eng', department_id: 'eng' }]
const memberSettings = [
  { user_id: 'u1', department_id: null },
  { user_id: 'hr-person', department_id: 'hr' },
  { user_id: 'payroll-person', department_id: 'hr-payroll' },
  { user_id: 'engineer', department_id: 'eng' },
]

const scopeFor = (userId: string, role: 'owner' | 'admin' | 'member' | 'viewer') =>
  buildTaskVisibilityScope({ userId, role, departments, teams, memberSettings })

describe('workspace task visibility', () => {
  it('owners and admins see every task', () => {
    const other = task({ assignee_id: 'engineer', created_by: 'engineer' })
    expect(canSeeWorkspaceTask(other, scopeFor('boss', 'owner'))).toBe(true)
    expect(canSeeWorkspaceTask(other, scopeFor('boss', 'admin'))).toBe(true)
  })

  it('a member without a home department still sees what is assigned to them', () => {
    const scope = scopeFor('u1', 'member')
    expect(canSeeWorkspaceTask(task({ assignee_id: 'u1', department_id: 'eng' }), scope)).toBe(true)
    expect(canSeeWorkspaceTask(task({ assignee_id: 'u1' }), scope)).toBe(true)
  })

  it('a member does not see other people’s tasks, even in their own department', () => {
    const scope = scopeFor('engineer', 'member')
    expect(canSeeWorkspaceTask(task({ assignee_id: 'other', created_by: 'x', department_id: 'eng' }), scope)).toBe(
      false,
    )
    expect(canSeeWorkspaceTask(task({ assignee_id: 'other', created_by: 'engineer' }), scope)).toBe(true)
  })

  it('a department head sees their department, the departments below it, and its people', () => {
    const scope = scopeFor('head', 'member')
    expect(canSeeWorkspaceTask(task({ assignee_id: 'x', created_by: 'x', department_id: 'hr' }), scope)).toBe(true)
    expect(
      canSeeWorkspaceTask(task({ assignee_id: 'x', created_by: 'x', department_id: 'hr-payroll' }), scope),
    ).toBe(true)
    // No department on the task: the assignee's home department decides.
    expect(canSeeWorkspaceTask(task({ assignee_id: 'payroll-person', created_by: 'x' }), scope)).toBe(true)
    expect(canSeeWorkspaceTask(task({ assignee_id: 'engineer', created_by: 'x' }), scope)).toBe(false)
    expect(canSeeWorkspaceTask(task({ assignee_id: null, created_by: 'x', team_id: 'team-eng' }), scope)).toBe(false)
  })

  it('department heads see their people; members only themselves', () => {
    expect(canSeeMemberWork('hr-person', scopeFor('head', 'member'))).toBe(true)
    expect(canSeeMemberWork('engineer', scopeFor('head', 'member'))).toBe(false)
    expect(canSeeMemberWork('engineer', scopeFor('u1', 'member'))).toBe(false)
    expect(canSeeMemberWork('u1', scopeFor('u1', 'member'))).toBe(true)
    expect(canSeeMemberWork('engineer', scopeFor('boss', 'admin'))).toBe(true)
  })

  it('projects follow task visibility', () => {
    const tasks = [task({ project_id: 'p1', assignee_id: 'u1' })]
    const projects = [project({ id: 'p1' }), project({ id: 'p2' }), project({ id: 'p3', created_by: 'u1' })]
    expect(filterProjectsForScope(projects, tasks, scopeFor('u1', 'member')).map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(filterProjectsForScope(projects, tasks, scopeFor('boss', 'owner'))).toHaveLength(3)
  })
})
