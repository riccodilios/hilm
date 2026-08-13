import type { WorkspaceDepartment } from '@/features/workspace-os/org-api'
import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'
import type { WorkspaceTask } from '@/features/workspace-os/api'

export type AssignmentState = 'unassigned' | 'team' | 'individual'

export type TaskAssignmentInfo = {
  state: AssignmentState
  department: { id: string; name: string } | null
  team: { id: string; name: string } | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
}

/** Own department + all descendants (not parents / siblings above). */
export function collectDescendantDepartmentIds(
  homeDepartmentId: string,
  departments: WorkspaceDepartment[],
): Set<string> {
  const children = new Map<string | null, string[]>()
  for (const dept of departments) {
    const key = dept.parent_id
    const list = children.get(key) ?? []
    list.push(dept.id)
    children.set(key, list)
  }
  const visible = new Set<string>()
  const stack = [homeDepartmentId]
  while (stack.length) {
    const id = stack.pop()!
    if (visible.has(id)) continue
    visible.add(id)
    for (const child of children.get(id) ?? []) stack.push(child)
  }
  return visible
}

export function resolveVisibleDepartmentIds(input: {
  role: WorkspaceRole
  homeDepartmentId: string | null
  departments: WorkspaceDepartment[]
}): Set<string> {
  if (input.role === 'owner' || input.role === 'admin') {
    return new Set(input.departments.map((d) => d.id))
  }
  if (!input.homeDepartmentId) return new Set()
  return collectDescendantDepartmentIds(input.homeDepartmentId, input.departments)
}

export function inferAssignmentState(task: {
  assignee_id?: string | null
  team_id?: string | null
  department_id?: string | null
}): AssignmentState {
  if (task.assignee_id) return 'individual'
  if (task.team_id || task.department_id) return 'team'
  return 'unassigned'
}

export function taskPassesDepartmentFilter(
  task: Pick<WorkspaceTask, 'department_id' | 'assignee_id' | 'created_by' | 'team_id'> & {
    assignment?: TaskAssignmentInfo | null
  },
  input: {
    selectedDepartmentIds: Set<string> | string[]
    userId: string | null
    leadTeamIds?: Set<string>
    includeUnscoped?: boolean
  },
): boolean {
  const selected =
    input.selectedDepartmentIds instanceof Set
      ? input.selectedDepartmentIds
      : new Set(input.selectedDepartmentIds)

  // Prefer explicit department_id; fall back to resolved team department from list enrichment.
  const departmentId = task.department_id ?? task.assignment?.department?.id ?? null

  // Empty selection → no department-scoped tasks (and no personal-relevance bypass).
  if (selected.size === 0) {
    return !departmentId && input.includeUnscoped !== false
  }

  if (!departmentId) {
    return input.includeUnscoped !== false
  }

  // Active department chips are authoritative — assignee/creator/lead must not keep
  // tasks from deselected departments visible.
  return selected.has(departmentId)
}

export function projectPassesDepartmentFilter(
  project: { team_id?: string | null },
  teamDepartmentById: Map<string, string | null>,
  selectedDepartmentIds: Set<string>,
  includeUnscoped = true,
): boolean {
  if (!project.team_id) return includeUnscoped
  const deptId = teamDepartmentById.get(project.team_id) ?? null
  if (!deptId) return includeUnscoped
  if (selectedDepartmentIds.size === 0) return false
  return selectedDepartmentIds.has(deptId)
}
