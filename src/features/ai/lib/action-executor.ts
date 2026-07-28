import { createNote } from '@/features/notes/api'
import { createProject, updateProject } from '@/features/projects/api'
import { createRoadmapItem } from '@/features/roadmap/api'
import { upsertDailyLog } from '@/features/daily-log/api'
import { createTask, moveTask, updateTask } from '@/features/tasks/api'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import { aiActionsArraySchema } from '@/types/ai-actions'
import type { AiAction } from '@/types/ai-actions'
import type { Priority, TaskStatus } from '@/types/domain'

export type ActionExecutionResult = {
  action: AiAction
  success: boolean
  data?: unknown
  error?: string
}

export async function executeAiActions(input: AiAction[]): Promise<ActionExecutionResult[]> {
  const actions = aiActionsArraySchema.parse(input)

  return Promise.all(
    actions.map(async (action): Promise<ActionExecutionResult> => {
      try {
        let data: unknown
        switch (action.type) {
          case 'task.complete':
            data = await updateTask(action.taskId, { status: 'done' })
            break
          case 'task.create':
            data = await createTask({
              title: action.title,
              description: action.description,
              projectId: action.projectId,
              priority: action.priority as Priority | undefined,
              status: action.status as TaskStatus | undefined,
              dueAt: action.dueAt,
            })
            break
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
            data = await createProject(action)
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
            data = await createNote(action)
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
            throw new Error('Idea actions are not supported yet')
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
