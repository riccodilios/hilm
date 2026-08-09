import { supabase } from '@/lib/supabase/client'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables, Updates } from '@/types/database'
import type { Priority, TaskStatus } from '@/types/domain'
import { refreshProjectCompletion } from '@/features/projects/api'
import {
  combineDueAt,
  computeRemindAt,
  type ReminderType,
  type TaskWithProject,
} from '@/features/tasks/reminders'

export const tasksKeys = {
  all: ['tasks'] as const,
  list: (filters?: string) => [...tasksKeys.all, 'list', filters ?? 'all'] as const,
  detail: (id: string) => [...tasksKeys.all, 'detail', id] as const,
  byProject: (projectId: string) => [...tasksKeys.all, 'project', projectId] as const,
}

const taskSelect = '*, projects(id, name, color, icon)'

function isNoRowsError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  if (error.code === 'PGRST116') return true
  return /coerce the result to a single json object/i.test(error.message ?? '')
}

function throwTaskNotFound(error?: { code?: string; message?: string } | null): never {
  if (error && !isNoRowsError(error)) throw error
  throw new Error('Task not found or you do not have access to it')
}

export async function listTasks(opts?: {
  projectId?: string
  status?: TaskStatus | TaskStatus[]
  dueBefore?: string
  dueAfter?: string
}) {
  let q = supabase
    .from('tasks')
    .select(taskSelect)
    .not('project_id', 'is', null)
    .neq('status', 'archived')
    .order('position')
    .order('due_at', { ascending: true })
  if (opts?.projectId) q = q.eq('project_id', opts.projectId)
  if (opts?.status) {
    if (Array.isArray(opts.status)) q = q.in('status', opts.status)
    else q = q.eq('status', opts.status)
  }
  if (opts?.dueBefore) q = q.lte('due_at', opts.dueBefore)
  if (opts?.dueAfter) q = q.gte('due_at', opts.dueAfter)
  const { data, error } = await q
  if (error) throw error
  return data as TaskWithProject[]
}

export async function getTask(id: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select(taskSelect)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) throwTaskNotFound()
  return data as TaskWithProject
}

async function upsertPrimaryReminder(input: {
  userId: string
  taskId: string
  projectId: string | null
  remindAt: string | null
  reminderType: ReminderType
}) {
  // Replace unsent primary reminders for this task
  const { error: deleteError } = await supabase
    .from('task_reminders')
    .delete()
    .eq('task_id', input.taskId)
    .eq('notification_sent', false)
  if (deleteError) {
    console.error('Failed to clear old reminders', deleteError)
  }

  if (!input.remindAt || !input.projectId) return null

  const { data: settings } = await supabase
    .from('user_settings')
    .select('email_reminders_enabled, push_notifications_enabled')
    .eq('user_id', input.userId)
    .maybeSingle()

  const channels: Array<'email' | 'push' | 'in_app'> = ['in_app']
  if (settings?.email_reminders_enabled !== false) channels.push('email')
  if (settings?.push_notifications_enabled) channels.push('push')

  // Avoid .single() — a missing RETURNING row must not fail the parent task action.
  const { error } = await supabase.from('task_reminders').insert({
    user_id: input.userId,
    task_id: input.taskId,
    project_id: input.projectId,
    remind_at: input.remindAt,
    reminder_type: input.reminderType,
    channels,
  })
  if (error) {
    console.error('Failed to create task reminder', error)
    return null
  }
  return true
}

export async function createTask(input: {
  title: string
  description?: string
  projectId: string
  priority?: Priority
  status?: TaskStatus
  dueDate?: string | null
  dueAt?: string | null
  reminderType?: ReminderType
  customReminderAt?: string | null
  estimatedHours?: number | null
}) {
  if (!input.projectId) throw new Error('Every task must belong to a project')
  const userId = await requireUserId()
  const dueDate = input.dueDate ?? (input.dueAt ? input.dueAt.slice(0, 10) : null)
  const dueAt = input.dueAt ?? combineDueAt(dueDate)
  const reminderType = input.reminderType ?? '1h'
  const reminderDatetime = computeRemindAt(dueAt, reminderType, input.customReminderAt)

  const payload: Inserts<'tasks'> = {
    user_id: userId,
    title: input.title,
    description: input.description ?? null,
    project_id: input.projectId,
    priority: input.priority ?? 'none',
    status: input.status ?? 'todo',
    due_at: dueAt,
    due_date: dueDate,
    due_time: null,
    reminder_at: reminderDatetime,
    reminder_datetime: reminderDatetime,
    reminder_type: reminderType,
    notification_sent: false,
    estimated_hours: input.estimatedHours ?? null,
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert(payload)
    .select(taskSelect)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Could not create task')

  await upsertPrimaryReminder({
    userId,
    taskId: data.id,
    projectId: data.project_id,
    remindAt: reminderDatetime,
    reminderType,
  })

  await recordActivity({
    userId,
    entityType: 'task',
    entityId: data.id,
    projectId: data.project_id,
    action: 'created',
    summary: `Created task ${data.title}`,
  })
  if (data.project_id) {
    try {
      await refreshProjectCompletion(data.project_id)
    } catch (error) {
      console.error('Failed to refresh project completion', error)
    }
  }
  return data as TaskWithProject
}

export async function updateTask(id: string, patch: Updates<'tasks'> & {
  reminderType?: ReminderType
  customReminderAt?: string | null
}) {
  const userId = await requireUserId()
  const next: Updates<'tasks'> = { ...patch }
  delete (next as { reminderType?: ReminderType }).reminderType
  delete (next as { customReminderAt?: string | null }).customReminderAt

  // Load once — avoids repeated .single() failures with opaque PostgREST errors.
  const current = await getTask(id)

  if (patch.due_date !== undefined || patch.due_time !== undefined) {
    const dueDate = patch.due_date !== undefined ? patch.due_date : current.due_date
    next.due_time = null
    // Keep an explicit due_at (timed schedule) when Mission Control provides one.
    if (patch.due_at === undefined) {
      next.due_at = combineDueAt(dueDate)
    }
  }

  if (patch.status === 'done' && !patch.completed_at) {
    next.completed_at = new Date().toISOString()
  }
  if (patch.status && patch.status !== 'done') {
    next.completed_at = null
  }

  const reminderType = patch.reminderType
  if (reminderType || patch.reminder_datetime !== undefined || next.due_at !== undefined) {
    const dueAt = (next.due_at !== undefined ? next.due_at : current.due_at) ?? null
    const type = (reminderType ?? (current.reminder_type as ReminderType | null) ?? '1h') as ReminderType
    const remindAt =
      patch.reminder_datetime !== undefined
        ? patch.reminder_datetime
        : computeRemindAt(dueAt, type, patch.customReminderAt)
    next.reminder_type = type
    next.reminder_datetime = remindAt
    next.reminder_at = remindAt
    next.notification_sent = false
    await upsertPrimaryReminder({
      userId,
      taskId: id,
      projectId: current.project_id,
      remindAt,
      reminderType: type,
    })
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(next)
    .eq('id', id)
    .select(taskSelect)
    .maybeSingle()
  if (error) throw error
  if (!data) throwTaskNotFound(error)

  await recordActivity({
    userId,
    entityType: 'task',
    entityId: id,
    projectId: data.project_id,
    action: patch.status === 'done' ? 'completed' : 'updated',
    summary:
      patch.status === 'done'
        ? `Completed task ${data.title}`
        : `Updated task ${data.title}`,
    metadata: patch as import('@/types/database').Json,
  })
  if (data.project_id) {
    try {
      await refreshProjectCompletion(data.project_id)
    } catch (refreshError) {
      console.error('Failed to refresh project completion', refreshError)
    }
  }
  return data as TaskWithProject
}

export async function moveTask(id: string, status: TaskStatus, position?: number) {
  return updateTask(id, {
    status,
    ...(typeof position === 'number' ? { position } : {}),
  })
}

export async function archiveTask(id: string) {
  return updateTask(id, { status: 'archived' })
}

export async function deleteTask(id: string) {
  const userId = await requireUserId()
  const current = await getTask(id)
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
  await recordActivity({
    userId,
    entityType: 'task',
    entityId: id,
    projectId: current.project_id,
    action: 'deleted',
    summary: `Deleted task ${current.title}`,
  })
  if (current.project_id) {
    try {
      await refreshProjectCompletion(current.project_id)
    } catch (refreshError) {
      console.error('Failed to refresh project completion', refreshError)
    }
  }
}

export async function listSubtasks(taskId: string) {
  const { data, error } = await supabase
    .from('subtasks')
    .select('*')
    .eq('task_id', taskId)
    .order('position')
  if (error) throw error
  return data as Tables<'subtasks'>[]
}
