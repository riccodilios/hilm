import { supabase } from '@/lib/supabase/client'
import { recordActivity } from '@/features/activity/record'
import { requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables } from '@/types/database'
import type { RoadmapHorizon } from '@/types/domain'
import { planRoadmapCompletion } from '@/features/roadmap/advance'

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
  const { data: created, error } = await supabase
    .from('roadmap_items')
    .insert(payload)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!created?.id) throw new Error('Could not create roadmap item')
  const { data, error: readError } = await supabase
    .from('roadmap_items')
    .select('*')
    .eq('id', created.id)
    .maybeSingle()
  if (readError) throw readError
  if (!data) throw new Error('Could not create roadmap item')
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
  const { error } = await supabase.from('roadmap_items').update(patch).eq('id', id)
  if (error) throw error
  const { data, error: readError } = await supabase
    .from('roadmap_items')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (readError) throw readError
  if (!data) throw new Error('Roadmap item not found')
  return data as Tables<'roadmap_items'>
}

export async function deleteRoadmapItem(id: string) {
  const { data: current, error: readError } = await supabase
    .from('roadmap_items')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (readError) throw readError
  if (!current) throw new Error('Roadmap item not found')
  const { error } = await supabase.from('roadmap_items').delete().eq('id', id)
  if (error) throw error
  const userId = await requireUserId()
  await recordActivity({
    userId,
    entityType: 'roadmap_item',
    entityId: id,
    projectId: current.project_id,
    action: 'deleted',
    summary: `Removed roadmap item ${current.title}`,
  })
}

/** Complete an item; when the last Now item finishes, promote Next → Now (and cascade). */
export async function completeRoadmapItem(id: string) {
  const { data: current, error: readError } = await supabase
    .from('roadmap_items')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (readError) throw readError
  if (!current) throw new Error('Roadmap item not found')

  const siblings = await listRoadmap(current.project_id)
  const plan = planRoadmapCompletion(
    siblings.map((item) => ({
      id: item.id,
      horizon: item.horizon,
      position: Number(item.position) || 0,
    })),
    id,
  )

  for (const move of plan.moves) {
    const { error } = await supabase
      .from('roadmap_items')
      .update({ horizon: move.horizon })
      .eq('id', move.id)
    if (error) throw error
  }

  const { error: deleteError } = await supabase.from('roadmap_items').delete().eq('id', plan.deleteId)
  if (deleteError) throw deleteError

  const userId = await requireUserId()
  await recordActivity({
    userId,
    entityType: 'roadmap_item',
    entityId: id,
    projectId: current.project_id,
    action: 'completed',
    summary:
      plan.moves.length > 0
        ? `Completed roadmap item ${current.title}; advanced Next into Now`
        : `Completed roadmap item ${current.title}`,
  })

  return listRoadmap(current.project_id)
}
