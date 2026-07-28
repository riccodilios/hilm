import { supabase } from '@/lib/supabase/client'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables } from '@/types/database'
import type { RoadmapHorizon } from '@/types/domain'

export const roadmapKeys = {
  all: ['roadmap'] as const,
  byProject: (projectId: string) => [...roadmapKeys.all, projectId] as const,
}

export async function listRoadmap(projectId: string) {
  const { data, error } = await supabase
    .from('roadmap_items')
    .select('*')
    .eq('project_id', projectId)
    .order('position')
  if (error) throw error
  return data as Tables<'roadmap_items'>[]
}

export async function createRoadmapItem(input: {
  projectId: string
  title: string
  description?: string
  horizon?: RoadmapHorizon
}) {
  const userId = await requireUserId()
  const payload: Inserts<'roadmap_items'> = {
    user_id: userId,
    project_id: input.projectId,
    title: input.title,
    description: input.description ?? null,
    horizon: input.horizon ?? 'next',
  }
  const { data, error } = await supabase.from('roadmap_items').insert(payload).select('*').single()
  if (error) throw error
  await recordActivity({
    userId,
    entityType: 'roadmap_item',
    entityId: data.id,
    projectId: input.projectId,
    action: 'created',
    summary: `Added roadmap item ${data.title}`,
  })
  return data as Tables<'roadmap_items'>
}

export async function updateRoadmapItem(
  id: string,
  patch: Partial<Pick<Tables<'roadmap_items'>, 'title' | 'description' | 'horizon' | 'position'>>,
) {
  const { data, error } = await supabase
    .from('roadmap_items')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as Tables<'roadmap_items'>
}
