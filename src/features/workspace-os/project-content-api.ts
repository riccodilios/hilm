import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { workspaceKeys } from '@/features/workspace-os/api'
import { planRoadmapCompletion } from '@/features/roadmap/advance'
import type { Tables } from '@/types/database'
import type { RoadmapHorizon } from '@/types/domain'

export type WorkspaceRoadmapItem = Tables<'workspace_roadmap_items'>
export type WorkspaceProjectNote = Tables<'workspace_project_notes'>

export const projectContentKeys = {
  roadmap: (workspaceId: string, projectId: string) =>
    [...workspaceKeys.all, 'roadmap', workspaceId, projectId] as const,
  notes: (workspaceId: string, projectId: string) =>
    [...workspaceKeys.all, 'project-notes', workspaceId, projectId] as const,
}

export async function listWorkspaceRoadmap(workspaceId: string, projectId: string) {
  const { data, error } = await supabase
    .from('workspace_roadmap_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('project_id', projectId)
    .order('position')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as WorkspaceRoadmapItem[]
}

export async function createWorkspaceRoadmapItem(
  workspaceId: string,
  input: { projectId: string; title: string; horizon: RoadmapHorizon },
) {
  const userId = await requireUserId()
  const { error } = await supabase.from('workspace_roadmap_items').insert({
    workspace_id: workspaceId,
    project_id: input.projectId,
    created_by: userId,
    title: input.title,
    horizon: input.horizon,
    position: Date.now(),
  })
  if (error) throw error
}

export async function updateWorkspaceRoadmapItem(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<WorkspaceRoadmapItem, 'title' | 'description' | 'horizon'>>,
) {
  const { error } = await supabase
    .from('workspace_roadmap_items')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .eq('id', id)
  if (error) throw error
}

export async function deleteWorkspaceRoadmapItem(workspaceId: string, id: string) {
  const { error } = await supabase
    .from('workspace_roadmap_items')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', id)
  if (error) throw error
}

/** Same rule as Personal OS: finishing the last Now item pulls the next horizon forward. */
export async function completeWorkspaceRoadmapItem(workspaceId: string, projectId: string, id: string) {
  const items = await listWorkspaceRoadmap(workspaceId, projectId)
  const plan = planRoadmapCompletion(
    items.map((item) => ({ id: item.id, horizon: item.horizon, position: Number(item.position) || 0 })),
    id,
  )
  for (const move of plan.moves) {
    await updateWorkspaceRoadmapItem(workspaceId, move.id, { horizon: move.horizon })
  }
  await deleteWorkspaceRoadmapItem(workspaceId, plan.deleteId)
}

export async function listWorkspaceProjectNotes(workspaceId: string, projectId: string) {
  const { data, error } = await supabase
    .from('workspace_project_notes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as WorkspaceProjectNote[]
}

export async function createWorkspaceProjectNote(workspaceId: string, projectId: string, title: string) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('workspace_project_notes')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      created_by: userId,
      updated_by: userId,
      title,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceProjectNote
}

export async function updateWorkspaceProjectNote(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<WorkspaceProjectNote, 'title' | 'body'>>,
) {
  const userId = await requireUserId()
  const { error } = await supabase
    .from('workspace_project_notes')
    .update({ ...patch, updated_by: userId })
    .eq('workspace_id', workspaceId)
    .eq('id', id)
  if (error) throw error
}

export async function deleteWorkspaceProjectNote(workspaceId: string, id: string) {
  const { error } = await supabase
    .from('workspace_project_notes')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', id)
  if (error) throw error
}
