import { createNote } from '@/features/notes/api'
import { createIdea } from '@/features/ideas/api'
import { createProject, listProjects, updateProject } from '@/features/projects/api'
import { createRoadmapItem } from '@/features/roadmap/api'
import { upsertDailyLog } from '@/features/daily-log/api'
import { createTask, moveTask, updateTask } from '@/features/tasks/api'
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

export async function executeAiActions(input: AiAction[]): Promise<ActionExecutionResult[]> {
  const actions = parseAiActions(input)
  if (!actions.length) {
    return input.map((action) => ({
      action,
      success: false,
      error: 'Action payload was invalid',
    }))
  }

  return Promise.all(
    actions.map(async (action): Promise<ActionExecutionResult> => {
      try {
        let data: unknown
        switch (action.type) {
          case 'task.complete':
            data = await updateTask(action.taskId, { status: 'done' })
            break
          case 'task.create': {
            const projectId = action.projectId ?? (await listProjects())[0]?.id
            if (!projectId) throw new Error('Create a project before creating a task')
            data = await createTask({
              title: action.title,
              description: action.description,
              projectId,
              priority: action.priority as Priority | undefined,
              status: action.status as TaskStatus | undefined,
              dueAt: action.dueAt,
            })
            break
          }
          case 'task.move':
            data = await moveTask(action.taskId, action.status as TaskStatus)
            break
          case 'task.update':
            data = await updateTask(action.taskId, {
              title: action.title,
              description: action.description,
              priority: action.priority as Priority | undefined,
              due_at: action.dueAt,
            })
            break
          case 'project.create':
            data = await createProject({
              name: action.name,
              description: action.description,
              color: action.color,
              icon: action.icon,
            })
            break
          case 'project.update':
            data = await updateProject(action.projectId, {
              name: action.name,
              description: action.description,
              completion_pct: action.completionPct,
              health: action.health,
            })
            break
          case 'note.create':
            data = await createNote({
              title: action.title,
              body: action.body,
              projectId: action.projectId,
            })
            break
          case 'roadmap.create':
            data = await createRoadmapItem({
              projectId: action.projectId,
              title: action.title,
              description: action.description,
              horizon: action.horizon,
            })
            break
          case 'daily_log.upsert':
            data = await upsertDailyLog({
              logDate: action.logDate,
              workedOn: action.workedOn,
              blockers: action.blockers,
              hours: action.hours,
              wins: action.wins,
              tomorrow: action.tomorrow,
              aiSummary: action.aiSummary,
            })
            break
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
            data = { recorded: true }
            break
          }
          case 'idea.create':
            data = await createIdea({
              title: action.title,
              description: action.description,
              projectId: action.projectId,
              impact: action.impact,
              effort: action.effort,
            })
            break
          default: {
            const exhaustive: never = action
            throw new Error(`Unsupported action: ${(exhaustive as AiAction).type}`)
          }
        }

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
