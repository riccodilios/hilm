import { supabase } from '@/lib/supabase/client'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables, Updates } from '@/types/database'
import type { Priority, TaskStatus } from '@/types/domain'
import { refreshProjectCompletion } from '@/features/projects/api'

export const tasksKeys = {
  all: ['tasks'] as const,
  list: (filters?: string) => [...tasksKeys.all, 'list', filters ?? 'all'] as const,
  detail: (id: string) => [...tasksKeys.all, 'detail', id] as const,
  byProject: (projectId: string) => [...tasksKeys.all, 'project', projectId] as const,
}

export async function listTasks(opts?: {
  projectId?: string
  status?: TaskStatus | TaskStatus[]
  dueBefore?: string
  dueAfter?: string
}) {
  let q = supabase
    .from('tasks')
    .select('*')
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
  return data as Tables<'tasks'>[]
}

export async function getTask(id: string) {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', id).single()
  if (error) throw error
  return data as Tables<'tasks'>
}

export async function createTask(input: {
  title: string
  description?: string
  projectId?: string | null
  priority?: Priority
  status?: TaskStatus
  dueAt?: string | null
  estimatedHours?: number | null
}) {
  const userId = await requireUserId()
  const payload: Inserts<'tasks'> = {
    user_id: userId,
    title: input.title,
    description: input.description ?? null,
    project_id: input.projectId ?? null,
    priority: input.priority ?? 'none',
    status: input.status ?? 'todo',
    due_at: input.dueAt ?? null,
    estimated_hours: input.estimatedHours ?? null,
  }
  const { data, error } = await supabase.from('tasks').insert(payload).select('*').single()
  if (error) throw error
  await recordActivity({
    userId,
    entityType: 'task',
    entityId: data.id,
    projectId: data.project_id,
    action: 'created',
    summary: `Created task ${data.title}`,
  })
  if (data.project_id) await refreshProjectCompletion(data.project_id)
  return data as Tables<'tasks'>
}

export async function updateTask(id: string, patch: Updates<'tasks'>) {
  const userId = await requireUserId()
  const next = { ...patch }
  if (patch.status === 'done' && !patch.completed_at) {
    next.completed_at = new Date().toISOString()
  }
  if (patch.status && patch.status !== 'done') {
    next.completed_at = null
  }
  const { data, error } = await supabase.from('tasks').update(next).eq('id', id).select('*').single()
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
  if (data.project_id) await refreshProjectCompletion(data.project_id)
  return data as Tables<'tasks'>
}

export async function moveTask(id: string, status: TaskStatus, position?: number) {
  return updateTask(id, {
    status,
    ...(typeof position === 'number' ? { position } : {}),
  })
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
