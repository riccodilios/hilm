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
  /** user id → the department they work in (see resolveMemberDepartments) */
  departmentByUser: Map<string, string>
  /** team id → department id */
  teamDepartmentById: Map<string, string | null>
}

/**
 * The department each person works in: their chosen home department, else the department they
 * head, else the department of a team they lead, else of a team they belong to.
 */
export function resolveMemberDepartments(input: {
  departments: Pick<WorkspaceDepartment, 'id' | 'head_user_id'>[]
  teams: Pick<WorkspaceTeam, 'id' | 'department_id' | 'lead_user_id'>[]
  teamMembers: { team_id: string; user_id: string }[]
  memberSettings: { user_id: string; department_id: string | null }[]
}): Map<string, string> {
  const known = new Set(input.departments.map((dept) => dept.id))
  const teamDepartment = new Map(input.teams.map((team) => [team.id, team.department_id]))
  const byUser = new Map<string, string>()
  const assign = (userId: string | null | undefined, departmentId: string | null | undefined) => {
    if (userId && departmentId && known.has(departmentId) && !byUser.has(userId)) byUser.set(userId, departmentId)
  }
  for (const row of input.memberSettings) assign(row.user_id, row.department_id)
  for (const dept of input.departments) assign(dept.head_user_id, dept.id)
  for (const team of input.teams) assign(team.lead_user_id, team.department_id)
  for (const row of input.teamMembers) assign(row.user_id, teamDepartment.get(row.team_id))
  return byUser
}

type ScopedTask = Pick<WorkspaceTask, 'assignee_id' | 'created_by' | 'department_id' | 'team_id'> & {
  assignment?: WorkspaceTask['assignment']
}

export function buildTaskVisibilityScope(input: {
  userId: string | null | undefined
  role: WorkspaceRole | null | undefined
  departments: WorkspaceDepartment[]
  teams: Pick<WorkspaceTeam, 'id' | 'department_id' | 'lead_user_id'>[]
  teamMembers: { team_id: string; user_id: string }[]
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
    departmentByUser: resolveMemberDepartments(input),
    teamDepartmentById: new Map(input.teams.map((team) => [team.id, team.department_id])),
  }
}

/**
 * The department a task counts under. An assigned task follows its assignee's department, so a
 * Tech member's work never shows under HR; otherwise the task's own department or team decides.
 */
export function taskDepartmentId(task: ScopedTask, scope: TaskVisibilityScope): string | null {
  const assigneeDepartment = task.assignee_id ? scope.departmentByUser.get(task.assignee_id) : undefined
  if (assigneeDepartment) return assigneeDepartment
  if (task.department_id) return task.department_id
  if (task.assignment?.department?.id) return task.assignment.department.id
  return (task.team_id ? scope.teamDepartmentById.get(task.team_id) : null) ?? null
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
  const department = scope.departmentByUser.get(memberUserId)
  return department != null && scope.headDepartmentIds.has(department)
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
