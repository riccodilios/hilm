import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { workspaceKeys } from '@/features/workspace-os/api'
import type { Tables, Updates } from '@/types/database'

export type WorkspaceLabel = Tables<'workspace_labels'>

export const workspaceLabelKeys = {
  all: (workspaceId: string) => [...workspaceKeys.all, 'labels', workspaceId] as const,
  project: (workspaceId: string, projectId: string) =>
    [...workspaceKeys.all, 'project-labels', workspaceId, projectId] as const,
}

export async function listWorkspaceLabels(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_labels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name')
  if (error) throw error
  return (data ?? []) as WorkspaceLabel[]
}

export async function createWorkspaceLabel(
  workspaceId: string,
  input: { name: string; color?: string },
) {
  await requireUserId()
  const { data, error } = await supabase
    .from('workspace_labels')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      color: input.color ?? '#94a3b8',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceLabel
}

export async function updateWorkspaceLabel(
  workspaceId: string,
  labelId: string,
  patch: Pick<Updates<'workspace_labels'>, 'name' | 'color'>,
) {
  const { data, error } = await supabase
    .from('workspace_labels')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .eq('id', labelId)
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceLabel
}

export async function deleteWorkspaceLabel(workspaceId: string, labelId: string) {
  const { error } = await supabase
    .from('workspace_labels')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', labelId)
  if (error) throw error
}

export async function listProjectLabels(workspaceId: string, projectId: string) {
  const { data: links, error } = await supabase
    .from('workspace_project_labels')
    .select('label_id')
    .eq('workspace_id', workspaceId)
    .eq('project_id', projectId)
  if (error) throw error
  const labelIds = (links ?? []).map((row) => row.label_id)
  if (!labelIds.length) return []
  const { data, error: labelsError } = await supabase
    .from('workspace_labels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('id', labelIds)
  if (labelsError) throw labelsError
  return (data ?? []) as WorkspaceLabel[]
}

export async function setProjectLabels(
  workspaceId: string,
  projectId: string,
  labelIds: string[],
) {
  await requireUserId()
  const { error: delError } = await supabase
    .from('workspace_project_labels')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('project_id', projectId)
  if (delError) throw delError

  if (!labelIds.length) return []

  const rows = labelIds.map((labelId) => ({
    workspace_id: workspaceId,
    project_id: projectId,
    label_id: labelId,
  }))
  const { error: insertError } = await supabase.from('workspace_project_labels').insert(rows)
  if (insertError) throw insertError
  return listProjectLabels(workspaceId, projectId)
}
