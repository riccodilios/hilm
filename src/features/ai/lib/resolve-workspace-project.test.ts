import { beforeEach, describe, expect, it, vi } from 'vitest'

const listWorkspaceProjects = vi.fn()

vi.mock('@/features/workspace-os/api', () => ({
  listWorkspaceProjects: (...args: unknown[]) => listWorkspaceProjects(...args),
}))

import { resolveWorkspaceProjectForAction } from '@/features/ai/lib/resolve-workspace-project'

const WASL = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  name: 'Wasl',
  workspace_id: 'ws-1',
}
const ACME = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  name: 'Acme',
  workspace_id: 'ws-1',
}
const WASL_ALT = {
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  name: 'Wasl Platform',
  workspace_id: 'ws-1',
}

describe('resolveWorkspaceProjectForAction', () => {
  beforeEach(() => {
    listWorkspaceProjects.mockReset()
  })

  it('resolves by case-insensitive project name within the workspace', async () => {
    listWorkspaceProjects.mockResolvedValue([WASL, ACME])
    const result = await resolveWorkspaceProjectForAction('ws-1', {
      projectName: 'wasl',
      projectId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.id).toBe(WASL.id)
  })

  it('rejects invented / personal project IDs when no name matches', async () => {
    listWorkspaceProjects.mockResolvedValue([WASL, ACME])
    const result = await resolveWorkspaceProjectForAction('ws-1', {
      projectId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    })
    expect(result.ok).toBe(false)
  })

  it('uses conversation focus project when it belongs to the workspace', async () => {
    listWorkspaceProjects.mockResolvedValue([WASL, ACME])
    const result = await resolveWorkspaceProjectForAction('ws-1', {
      preferProjectId: WASL.id,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.id).toBe(WASL.id)
  })

  it('asks when multiple projects match ambiguously', async () => {
    listWorkspaceProjects.mockResolvedValue([WASL, WASL_ALT])
    const result = await resolveWorkspaceProjectForAction('ws-1', {
      projectName: 'Wasl',
    })
    // Exact "Wasl" should still win over "Wasl Platform"
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.id).toBe(WASL.id)
  })

  it('matches “Wasl project” keyword noise to Wasl', async () => {
    listWorkspaceProjects.mockResolvedValue([WASL, ACME])
    const result = await resolveWorkspaceProjectForAction('ws-1', {
      projectName: 'Wasl project',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.id).toBe(WASL.id)
  })

  it('does not treat the workspace name alone as a weak project match', async () => {
    listWorkspaceProjects.mockResolvedValue([
      ACME,
      { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', name: 'Primed Ops', workspace_id: 'ws-1' },
    ])
    const result = await resolveWorkspaceProjectForAction('ws-1', {
      projectName: 'IMED',
      workspaceName: 'IMED',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/workspace name/i)
  })

  it('does not invent a project when none match', async () => {
    listWorkspaceProjects.mockResolvedValue([ACME])
    const result = await resolveWorkspaceProjectForAction('ws-1', {
      projectName: 'Wasl',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/couldn’t find a project named/i)
  })
})
