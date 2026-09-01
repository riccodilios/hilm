import type { WorkspaceTask, WorkspaceProject } from '@/features/workspace-os/api'
import type { TaskWithProject } from '@/shared/reminders'
import type { MissionProjectInsight } from '@/shared/mission-control/types'

/** Map workspace tasks into the shape Mission Control already understands. */
export function workspaceTaskAsMission(task: WorkspaceTask): TaskWithProject {
  return {
    id: task.id,
    user_id: task.created_by,
    project_id: task.project_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_at: task.due_at,
    due_date: task.due_date,
    due_time: null,
    estimated_hours: task.estimated_hours,
    actual_hours: null,
    position: task.position,
    completed_at: task.completed_at,
    created_at: task.created_at,
    updated_at: task.updated_at,
    reminder_at: task.reminder_at,
    reminder_datetime: task.reminder_at,
    reminder_type: task.reminder_type,
    notification_sent: false,
    projects: task.workspace_projects
      ? {
          id: task.workspace_projects.id,
          name: task.workspace_projects.name,
          color: task.workspace_projects.color,
          icon: task.workspace_projects.icon,
        }
      : null,
  }
}

export function workspaceProjectAsInsight(
  project: WorkspaceProject & {
    remainingTasks?: number
    overdueCount?: number
    nextDeadline?: string | null
  },
): MissionProjectInsight {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    health: project.health as MissionProjectInsight['health'],
  }
}
