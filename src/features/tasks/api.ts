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
    .single()
  if (error) throw error
  return data as TaskWithProject
}

async function upsertPrimaryReminder(input: {
  userId: string
  taskId: string
  projectId: string
  remindAt: string | null
  reminderType: ReminderType
}) {
  // Replace unsent primary reminders for this task
  await supabase
    .from('task_reminders')
    .delete()
    .eq('task_id', input.taskId)
    .eq('notification_sent', false)

  if (!input.remindAt) return null

  const { data: settings } = await supabase
    .from('user_settings')
    .select('email_reminders_enabled, push_notifications_enabled')
    .eq('user_id', input.userId)
    .maybeSingle()

  const channels: Array<'email' | 'push' | 'in_app'> = ['in_app']
  if (settings?.email_reminders_enabled !== false) channels.push('email')
  if (settings?.push_notifications_enabled) channels.push('push')

  const { data, error } = await supabase
    .from('task_reminders')
    .insert({
      user_id: input.userId,
      task_id: input.taskId,
      project_id: input.projectId,
      remind_at: input.remindAt,
      reminder_type: input.reminderType,
      channels,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
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
    .single()
  if (error) throw error

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
  await refreshProjectCompletion(data.project_id)
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

  if (patch.due_date !== undefined || patch.due_time !== undefined) {
    const current = await getTask(id)
    const dueDate = patch.due_date !== undefined ? patch.due_date : current.due_date
    next.due_time = null
    next.due_at = combineDueAt(dueDate)
  }

  if (patch.status === 'done' && !patch.completed_at) {
    next.completed_at = new Date().toISOString()
  }
  if (patch.status && patch.status !== 'done') {
    next.completed_at = null
  }

  const reminderType = patch.reminderType
  if (reminderType || patch.reminder_datetime !== undefined || next.due_at !== undefined) {
    const current = await getTask(id)
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
    .single()
  if (error) throw error

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
  await refreshProjectCompletion(data.project_id)
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
  await refreshProjectCompletion(current.project_id)
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
