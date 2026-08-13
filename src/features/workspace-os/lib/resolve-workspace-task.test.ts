import { beforeEach, describe, expect, it, vi } from 'vitest'

const listWorkspaceTasks = vi.fn()
const getWorkspace = vi.fn()

vi.mock('@/features/workspace-os/api', () => ({
  listWorkspaceTasks: (...args: unknown[]) => listWorkspaceTasks(...args),
  getWorkspace: (...args: unknown[]) => getWorkspace(...args),
  getWorkspaceTask: vi.fn(),
}))

import { resolveWorkspaceTaskForAction } from '@/features/workspace-os/lib/resolve-workspace-task'

const TASK_A = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Fix Appointment Hover/Floating UX Issue in Schedule',
  task_number: 24,
  workspace_id: 'ws-1',
}
const TASK_B = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Enhancement Request Portal',
  task_number: 25,
  workspace_id: 'ws-1',
}

describe('resolveWorkspaceTaskForAction', () => {
  beforeEach(() => {
    listWorkspaceTasks.mockReset()
    getWorkspace.mockReset()
    getWorkspace.mockResolvedValue({ id: 'ws-1', task_key: 'IMED', name: 'IMED' })
    listWorkspaceTasks.mockResolvedValue([TASK_A, TASK_B])
  })

  it('resolves by short id', async () => {
    const result = await resolveWorkspaceTaskForAction('ws-1', { taskId: 'IMED-24' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.task.id).toBe(TASK_A.id)
  })

  it('resolves by exact title stuffed into taskId (model habit)', async () => {
    const result = await resolveWorkspaceTaskForAction('ws-1', {
      taskId: 'Fix Appointment Hover/Floating UX Issue in Schedule',
      preferTaskId: TASK_B.id,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.task.id).toBe(TASK_A.id)
  })

  it('does not use preferTaskId when a title is provided', async () => {
    const result = await resolveWorkspaceTaskForAction('ws-1', {
      taskId: 'Enhancement Request Portal',
      preferTaskId: TASK_A.id,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.task.id).toBe(TASK_B.id)
  })

  it('uses preferTaskId only when no identifier is given', async () => {
    const result = await resolveWorkspaceTaskForAction('ws-1', {
      preferTaskId: TASK_B.id,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.task.id).toBe(TASK_B.id)
  })
})
