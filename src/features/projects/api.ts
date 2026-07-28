import { supabase } from '@/lib/supabase/client'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables, Updates } from '@/types/database'
import type { Priority, ProjectStatus } from '@/types/domain'

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
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single()
  if (error) throw error
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
  const { data, error } = await supabase.from('projects').insert(payload).select('*').single()
  if (error) throw error
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
    .single()
  if (error) throw error
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

export async function refreshProjectCompletion(projectId: string) {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('status')
    .eq('project_id', projectId)
    .neq('status', 'archived')
  if (error) throw error
  const total = tasks?.length ?? 0
  const done = tasks?.filter((t) => t.status === 'done').length ?? 0
  const pct = total === 0 ? 0 : Math.round((done / total) * 1000) / 10
  return updateProject(projectId, { completion_pct: pct })
}
