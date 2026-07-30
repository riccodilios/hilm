import { createNote } from '@/features/notes/api'
import { createIdea } from '@/features/ideas/api'
import { createProject, listProjects, updateProject } from '@/features/projects/api'
import { createRoadmapItem } from '@/features/roadmap/api'
import { upsertDailyLog } from '@/features/daily-log/api'
import { createTask, moveTask, updateTask } from '@/features/tasks/api'
import {
  createWorkspaceProject,
  createWorkspaceTask,
  listWorkspaceProjects,
  recordWorkspaceActivityNote,
  updateWorkspaceProject,
  updateWorkspaceTask,
} from '@/features/workspace-os/api'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import { parseAiActions } from '@/types/ai-actions'
import type { AiAction } from '@/types/ai-actions'
import type { Priority, TaskStatus } from '@/types/domain'

export type ActionExecutionResult = {
  action: AiAction
  success: boolean
  data?: unknown
  error?: string
}

export type ExecuteAiActionsOptions = {
  workspaceId?: string
}

async function executePersonalAction(action: AiAction): Promise<unknown> {
  switch (action.type) {
    case 'task.complete':
      return updateTask(action.taskId, { status: 'done' })
    case 'task.create': {
      const projectId = action.projectId ?? (await listProjects())[0]?.id
      if (!projectId) throw new Error('Create a project before creating a task')
      return createTask({
        title: action.title,
        description: action.description,
        projectId,
        priority: action.priority as Priority | undefined,
        status: action.status as TaskStatus | undefined,
        dueAt: action.dueAt,
      })
    }
    case 'task.move':
      return moveTask(action.taskId, action.status as TaskStatus)
    case 'task.update':
      return updateTask(action.taskId, {
        title: action.title,
        description: action.description,
        priority: action.priority as Priority | undefined,
        due_at: action.dueAt,
      })
    case 'task.assign':
      throw new Error('Task assignment is only available in Workspace OS')
    case 'project.create':
      return createProject({
        name: action.name,
        description: action.description,
        color: action.color,
        icon: action.icon,
      })
    case 'project.update':
      return updateProject(action.projectId, {
        name: action.name,
        description: action.description,
        completion_pct: action.completionPct,
        health: action.health,
      })
    case 'note.create':
      return createNote({
        title: action.title,
        body: action.body,
        projectId: action.projectId,
      })
    case 'roadmap.create':
      return createRoadmapItem({
        projectId: action.projectId,
        title: action.title,
        description: action.description,
        horizon: action.horizon,
      })
    case 'daily_log.upsert':
      return upsertDailyLog({
        logDate: action.logDate,
        workedOn: action.workedOn,
        blockers: action.blockers,
        hours: action.hours,
        wins: action.wins,
        tomorrow: action.tomorrow,
        aiSummary: action.aiSummary,
      })
    case 'activity.note': {
      const userId = await requireUserId()
      await recordActivity({
        userId,
        entityType: action.entityType ?? 'ai_note',
        entityId: action.entityId,
        projectId: action.projectId,
        action: 'noted',
        summary: action.summary,
      })
      return { recorded: true }
    }
    case 'idea.create':
      return createIdea({
        title: action.title,
        description: action.description,
        projectId: action.projectId,
        impact: action.impact,
        effort: action.effort,
      })
    case 'documentation.generate':
    case 'meeting.summarize':
    case 'release.notes':
    case 'milestone.create':
      throw new Error(`${action.type} is only available in Workspace OS`)
    default: {
      const exhaustive: never = action
      throw new Error(`Unsupported action: ${(exhaustive as AiAction).type}`)
    }
  }
}

async function executeWorkspaceAction(workspaceId: string, action: AiAction): Promise<unknown> {
  switch (action.type) {
    case 'task.complete':
      return updateWorkspaceTask(workspaceId, action.taskId, { status: 'done' })
    case 'task.create': {
      const projectId =
        action.projectId ?? (await listWorkspaceProjects(workspaceId))[0]?.id
      if (!projectId) throw new Error('Create a workspace project before creating a task')
      return createWorkspaceTask(workspaceId, {
        projectId,
        title: action.title,
        description: action.description,
        priority: action.priority as Priority | undefined,
        status: action.status as TaskStatus | undefined,
        dueDate: action.dueAt ?? null,
        assigneeId: action.assigneeId ?? null,
      })
    }
    case 'task.move':
      return updateWorkspaceTask(workspaceId, action.taskId, {
        status: action.status as TaskStatus,
      })
    case 'task.update':
      return updateWorkspaceTask(workspaceId, action.taskId, {
        title: action.title,
        description: action.description,
        priority: action.priority as Priority | undefined,
        due_date: action.dueAt,
        due_at: action.dueAt,
      })
    case 'task.assign':
      return updateWorkspaceTask(workspaceId, action.taskId, {
        assignee_id: action.assigneeId,
      })
    case 'project.create':
      return createWorkspaceProject(workspaceId, {
        name: action.name,
        description: action.description,
        color: action.color,
        icon: action.icon,
      })
    case 'project.update':
      return updateWorkspaceProject(workspaceId, action.projectId, {
        name: action.name,
        description: action.description,
        completion_pct: action.completionPct,
        health: action.health,
      })
    case 'activity.note':
      return recordWorkspaceActivityNote(workspaceId, {
        summary: action.summary,
        entityType: action.entityType,
        entityId: action.entityId,
        projectId: action.projectId,
      })
    case 'documentation.generate':
      return recordWorkspaceActivityNote(workspaceId, {
        summary: `Documentation: ${action.title}`,
        entityType: 'documentation',
        entityId: action.projectId,
        projectId: action.projectId,
        payload: { title: action.title, body: action.body ?? '' },
      })
    case 'meeting.summarize':
      return recordWorkspaceActivityNote(workspaceId, {
        summary: `Meeting: ${action.title}`,
        entityType: 'meeting',
        entityId: action.projectId,
        projectId: action.projectId,
        payload: { title: action.title, summary: action.summary },
      })
    case 'release.notes':
      return recordWorkspaceActivityNote(workspaceId, {
        summary: `Release notes: ${action.title}`,
        entityType: 'release',
        entityId: action.projectId,
        projectId: action.projectId,
        payload: { title: action.title, body: action.body },
      })
    case 'milestone.create':
      return recordWorkspaceActivityNote(workspaceId, {
        summary: `Milestone: ${action.title}`,
        entityType: 'milestone',
        entityId: action.projectId,
        projectId: action.projectId,
        payload: { title: action.title, dueAt: action.dueAt ?? null },
      })
    case 'note.create':
    case 'roadmap.create':
    case 'daily_log.upsert':
    case 'idea.create':
      throw new Error(`${action.type} is only available in Personal OS`)
    default: {
      const exhaustive: never = action
      throw new Error(`Unsupported action: ${(exhaustive as AiAction).type}`)
    }
  }
}

export async function executeAiActions(
  input: AiAction[],
  options?: ExecuteAiActionsOptions,
): Promise<ActionExecutionResult[]> {
  const actions = parseAiActions(input)
  if (!actions.length) {
    return input.map((action) => ({
      action,
      success: false,
      error: 'Action payload was invalid',
    }))
  }

  const workspaceId = options?.workspaceId

  return Promise.all(
    actions.map(async (action): Promise<ActionExecutionResult> => {
      try {
        const data = workspaceId
          ? await executeWorkspaceAction(workspaceId, action)
          : await executePersonalAction(action)
        return { action, success: true, data }
      } catch (error) {
        return {
          action,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to execute action',
        }
      }
    }),
  )
}
