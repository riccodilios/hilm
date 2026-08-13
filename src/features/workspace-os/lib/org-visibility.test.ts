import { describe, expect, it } from 'vitest'
import { taskPassesDepartmentFilter } from '@/features/workspace-os/lib/org-visibility'

const base = {
  userId: 'user-1',
  leadTeamIds: new Set<string>(),
  includeUnscoped: false,
}

describe('taskPassesDepartmentFilter', () => {
  it('shows only tasks in currently selected departments', () => {
    const finance = {
      department_id: 'finance',
      assignee_id: null,
      created_by: 'other',
      team_id: null,
    }
    const tech = {
      department_id: 'tech',
      assignee_id: null,
      created_by: 'other',
      team_id: null,
    }

    expect(
      taskPassesDepartmentFilter(finance, {
        ...base,
        selectedDepartmentIds: ['finance', 'tech'],
      }),
    ).toBe(true)
    expect(
      taskPassesDepartmentFilter(tech, {
        ...base,
        selectedDepartmentIds: ['finance', 'tech'],
      }),
    ).toBe(true)

    expect(
      taskPassesDepartmentFilter(finance, {
        ...base,
        selectedDepartmentIds: ['finance'],
      }),
    ).toBe(true)
    expect(
      taskPassesDepartmentFilter(tech, {
        ...base,
        selectedDepartmentIds: ['finance'],
      }),
    ).toBe(false)
  })

  it('does not keep deselected-department tasks via assignee/creator/lead bypass', () => {
    const techMine = {
      department_id: 'tech',
      assignee_id: 'user-1',
      created_by: 'user-1',
      team_id: 'team-tech',
    }

    expect(
      taskPassesDepartmentFilter(techMine, {
        ...base,
        selectedDepartmentIds: ['finance'],
        leadTeamIds: new Set(['team-tech']),
      }),
    ).toBe(false)
  })

  it('uses resolved assignment department when task.department_id is null', () => {
    const viaTeam = {
      department_id: null,
      assignee_id: null,
      created_by: 'other',
      team_id: 'team-tech',
      assignment: {
        state: 'team' as const,
        department: { id: 'tech', name: 'Tech' },
        team: { id: 'team-tech', name: 'Platform' },
        assignee: null,
      },
    }

    expect(
      taskPassesDepartmentFilter(viaTeam, {
        ...base,
        selectedDepartmentIds: ['tech'],
      }),
    ).toBe(true)
    expect(
      taskPassesDepartmentFilter(viaTeam, {
        ...base,
        selectedDepartmentIds: ['finance'],
      }),
    ).toBe(false)
  })

  it('hides department tasks when nothing is selected', () => {
    expect(
      taskPassesDepartmentFilter(
        {
          department_id: 'finance',
          assignee_id: 'user-1',
          created_by: 'user-1',
          team_id: null,
        },
        { ...base, selectedDepartmentIds: [] },
      ),
    ).toBe(false)
  })

  it('optionally includes unscoped tasks', () => {
    const unscoped = {
      department_id: null,
      assignee_id: null,
      created_by: 'other',
      team_id: null,
    }
    expect(
      taskPassesDepartmentFilter(unscoped, {
        ...base,
        selectedDepartmentIds: ['finance'],
        includeUnscoped: false,
      }),
    ).toBe(false)
    expect(
      taskPassesDepartmentFilter(unscoped, {
        ...base,
        selectedDepartmentIds: ['finance'],
        includeUnscoped: true,
      }),
    ).toBe(true)
  })
})
