import type { WorkspaceProject, WorkspaceTask } from '@/features/workspace-os/api'
import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'
import { hasFullWorkspaceAccess } from '@/features/workspace-os/lib/page-permissions'

export function seesAllWorkspaceData(role: WorkspaceRole | null | undefined) {
  return hasFullWorkspaceAccess(role)
}

/** Whether a member can see this task (owners/admins see all). */
export function memberCanSeeTask(
  task: Pick<WorkspaceTask, 'assignee_id' | 'created_by'>,
  userId: string | null | undefined,
  role: WorkspaceRole | null | undefined,
) {
  if (!userId) return false
  if (seesAllWorkspaceData(role)) return true
  return task.assignee_id === userId || task.created_by === userId
}

export function filterTasksForMember(
  tasks: WorkspaceTask[],
  userId: string | null | undefined,
  role: WorkspaceRole | null | undefined,
) {
  if (seesAllWorkspaceData(role)) return tasks
  if (!userId) return []
  return tasks.filter((task) => memberCanSeeTask(task, userId, role))
}

export function filterProjectsForMember(
  projects: WorkspaceProject[],
  tasks: WorkspaceTask[],
  userId: string | null | undefined,
  role: WorkspaceRole | null | undefined,
) {
  if (seesAllWorkspaceData(role)) return projects
  if (!userId) return []
  const visibleTasks = filterTasksForMember(tasks, userId, role)
  const projectIds = new Set(visibleTasks.map((task) => task.project_id))
  return projects.filter(
    (project) => projectIds.has(project.id) || project.created_by === userId,
  )
}
