import { supabase } from '@/lib/supabase/client'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import { taskDueDateKey, todayLocalISO } from '@/lib/dates'
import {
  computeProjectHealth,
  toPersistedHealthStatus,
} from '@/features/projects/health'
import type { Inserts, Tables, Updates } from '@/types/database'
import type { Priority, ProjectStatus } from '@/types/domain'
import { addDays } from 'date-fns'

export const projectsKeys = {
  all: ['projects'] as const,
  list: () => [...projectsKeys.all, 'list'] as const,
  detail: (id: string) => [...projectsKeys.all, 'detail', id] as const,
}

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data as Tables<'projects'>[]
}

export async function getProject(id: string) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Project not found or you do not have access to it')
  return data as Tables<'projects'>
}

export async function createProject(input: {
  name: string
  description?: string
  color?: string
  icon?: string
  priority?: Priority
  status?: ProjectStatus
}) {
  const userId = await requireUserId()
  const payload: Inserts<'projects'> = {
    user_id: userId,
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? '#60a5fa',
    icon: input.icon ?? 'folder',
    priority: input.priority ?? 'medium',
    status: input.status ?? 'active',
  }
  const { data, error } = await supabase.from('projects').insert(payload).select('*').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Could not create project')
  await recordActivity({
    userId,
    entityType: 'project',
    entityId: data.id,
    projectId: data.id,
    action: 'created',
    summary: `Created project ${data.name}`,
  })
  return data as Tables<'projects'>
}

export async function updateProject(id: string, patch: Updates<'projects'>) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Project not found or you do not have access to it')
  await recordActivity({
    userId,
    entityType: 'project',
    entityId: id,
    projectId: id,
    action: 'updated',
    summary: `Updated project ${data.name}`,
    metadata: patch as import('@/types/database').Json,
  })
  return data as Tables<'projects'>
}

export async function deleteProject(id: string) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('projects')
    .update({ status: 'archived' })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Project not found or you do not have access to it')
  await recordActivity({
    userId,
    entityType: 'project',
    entityId: id,
    projectId: id,
    action: 'archived',
    summary: `Archived project ${data.name}`,
  })
  return data as Tables<'projects'>
}

export async function refreshProjectCompletion(projectId: string) {
  if (!projectId) return null
  const now = new Date()
  const todayKey = todayLocalISO()
  const weekAgo = addDays(now, -7).toISOString()
  const twoWeeksAgo = addDays(now, -14).toISOString()

  const [{ data: tasks, error }, { data: activity }, { count: notesCount }, { data: roadmap }] =
    await Promise.all([
      supabase
        .from('tasks')
        .select('status, due_date, due_at, completed_at, updated_at, created_at')
        .eq('project_id', projectId)
        .neq('status', 'archived'),
      supabase
        .from('activity_events')
        .select('created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('notes')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
      supabase.from('roadmap_items').select('id, horizon').eq('project_id', projectId),
    ])
  if (error) throw error

  const list = tasks ?? []
  const open = list.filter((task) => task.status !== 'done')
  const done = list.filter((task) => task.status === 'done')
  const total = list.length
  const pct = total === 0 ? 0 : Math.round((done.length / total) * 1000) / 10
  const overdueCount = open.filter((task) => {
    const key = taskDueDateKey(task)
    return Boolean(key && key < todayKey)
  }).length

  const lastFromTasks = list.reduce<string | null>((latest, task) => {
    const stamp = task.updated_at || task.completed_at || task.created_at
    if (!stamp) return latest
    if (!latest || stamp > latest) return stamp
    return latest
  }, null)
  const lastActiveAt = activity?.[0]?.created_at ?? lastFromTasks

  const computed = computeProjectHealth({
    completionPct: pct,
    totalTasks: total,
    doneTasks: done.length,
    openTasks: open.length,
    overdueCount,
    waitingCount: open.filter((task) => task.status === 'waiting').length,
    inProgressCount: open.filter((task) => task.status === 'in_progress').length,
    notesCount: notesCount ?? 0,
    roadmapTotal: roadmap?.length ?? 0,
    roadmapDone: 0,
    lastActivityAt: lastActiveAt,
    recentCompletions7d: done.filter((task) => task.completed_at && task.completed_at >= weekAgo)
      .length,
    priorCompletions7d: done.filter(
      (task) =>
        task.completed_at && task.completed_at >= twoWeeksAgo && task.completed_at < weekAgo,
    ).length,
  })

  const { data, error: updateError } = await supabase
    .from('projects')
    .update({
      completion_pct: pct,
      health: toPersistedHealthStatus(computed.health),
      health_explanation: computed.explanation,
    })
    .eq('id', projectId)
    .select('*')
    .maybeSingle()
  if (updateError) throw updateError
  return (data as Tables<'projects'> | null) ?? null
}
