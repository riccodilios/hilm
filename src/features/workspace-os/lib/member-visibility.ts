import type { WorkspaceProject, WorkspaceTask } from '@/features/workspace-os/api'
import type { WorkspaceDepartment, WorkspaceTeam } from '@/features/workspace-os/org-api'
import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'
import { hasFullWorkspaceAccess } from '@/features/workspace-os/lib/page-permissions'
import { collectDescendantDepartmentIds } from '@/features/workspace-os/lib/org-visibility'

export function seesAllWorkspaceData(role: WorkspaceRole | null | undefined) {
  return hasFullWorkspaceAccess(role)
}

/**
 * Who sees which tasks:
 * - owners and admins: every task
 * - department heads: tasks in the departments they head (and those below), plus tasks assigned
 *   to people whose home department is one of those
 * - everyone: tasks assigned to them, and tasks they created
 */
export type TaskVisibilityScope = {
  userId: string | null
  seesAll: boolean
  /** Departments the user heads, with every department below them. */
  headDepartmentIds: Set<string>
  /** user id → home department id */
  homeDepartmentByUser: Map<string, string | null>
  /** team id → department id */
  teamDepartmentById: Map<string, string | null>
}

type ScopedTask = Pick<WorkspaceTask, 'assignee_id' | 'created_by' | 'department_id' | 'team_id'> & {
  assignment?: WorkspaceTask['assignment']
}

export function buildTaskVisibilityScope(input: {
  userId: string | null | undefined
  role: WorkspaceRole | null | undefined
  departments: WorkspaceDepartment[]
  teams: Pick<WorkspaceTeam, 'id' | 'department_id'>[]
  memberSettings: { user_id: string; department_id: string | null }[]
}): TaskVisibilityScope {
  const userId = input.userId ?? null
  const headDepartmentIds = new Set<string>()
  if (userId) {
    for (const dept of input.departments) {
      if (dept.head_user_id !== userId) continue
      for (const id of collectDescendantDepartmentIds(dept.id, input.departments)) headDepartmentIds.add(id)
    }
  }
  return {
    userId,
    seesAll: seesAllWorkspaceData(input.role),
    headDepartmentIds,
    homeDepartmentByUser: new Map(input.memberSettings.map((row) => [row.user_id, row.department_id])),
    teamDepartmentById: new Map(input.teams.map((team) => [team.id, team.department_id])),
  }
}

/** The department a task belongs to: its own, its team's, or else its assignee's home department. */
export function taskDepartmentId(task: ScopedTask, scope: TaskVisibilityScope): string | null {
  if (task.department_id) return task.department_id
  if (task.assignment?.department?.id) return task.assignment.department.id
  const teamDepartment = task.team_id ? scope.teamDepartmentById.get(task.team_id) : null
  if (teamDepartment) return teamDepartment
  return (task.assignee_id ? scope.homeDepartmentByUser.get(task.assignee_id) : null) ?? null
}

export function canSeeWorkspaceTask(task: ScopedTask, scope: TaskVisibilityScope) {
  if (!scope.userId) return false
  if (scope.seesAll) return true
  if (task.assignee_id === scope.userId || task.created_by === scope.userId) return true
  if (!scope.headDepartmentIds.size) return false
  const departmentId = taskDepartmentId(task, scope)
  return departmentId != null && scope.headDepartmentIds.has(departmentId)
}

/** Members the user can see work for: everyone for owners/admins, a head's department, or just themselves. */
export function canSeeMemberWork(memberUserId: string, scope: TaskVisibilityScope) {
  if (scope.seesAll || memberUserId === scope.userId) return true
  const home = scope.homeDepartmentByUser.get(memberUserId)
  return home != null && scope.headDepartmentIds.has(home)
}

export function filterProjectsForScope<P extends Pick<WorkspaceProject, 'id' | 'created_by' | 'team_id'>>(
  projects: P[],
  tasks: WorkspaceTask[],
  scope: TaskVisibilityScope,
): P[] {
  if (scope.seesAll) return projects
  if (!scope.userId) return []
  const projectIds = new Set(
    tasks.filter((task) => canSeeWorkspaceTask(task, scope)).map((task) => task.project_id),
  )
  return projects.filter((project) => {
    if (projectIds.has(project.id) || project.created_by === scope.userId) return true
    const departmentId = project.team_id ? scope.teamDepartmentById.get(project.team_id) : null
    return departmentId != null && scope.headDepartmentIds.has(departmentId)
  })
}
