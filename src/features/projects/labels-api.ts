import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import type { Tables, Updates } from '@/types/database'

export type Tag = Tables<'tags'>

export const labelKeys = {
  all: ['labels'] as const,
  list: () => [...labelKeys.all, 'list'] as const,
  project: (projectId: string) => [...labelKeys.all, 'project', projectId] as const,
}

export async function listLabels() {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .order('name')
  if (error) throw error
  return (data ?? []) as Tag[]
}

export async function createLabel(input: { name: string; color?: string }) {
  const userId = await requireUserId()
  const { data: created, error } = await supabase
    .from('tags')
    .insert({
      user_id: userId,
      name: input.name,
      color: input.color ?? '#94a3b8',
    })
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!created?.id) throw new Error('Could not create label')
  const { data, error: readError } = await supabase
    .from('tags')
    .select('*')
    .eq('id', created.id)
    .maybeSingle()
  if (readError) throw readError
  if (!data) throw new Error('Could not create label')
  return data as Tag
}

export async function updateLabel(labelId: string, patch: Pick<Updates<'tags'>, 'name' | 'color'>) {
  const userId = await requireUserId()
  const { error } = await supabase
    .from('tags')
    .update(patch)
    .eq('id', labelId)
    .eq('user_id', userId)
  if (error) throw error
  const { data, error: readError } = await supabase
    .from('tags')
    .select('*')
    .eq('id', labelId)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) throw readError
  if (!data) throw new Error('Label not found')
  return data as Tag
}

export async function deleteLabel(labelId: string) {
  const userId = await requireUserId()
  const { error: tagError } = await supabase
    .from('entity_tags')
    .delete()
    .eq('user_id', userId)
    .eq('tag_id', labelId)
  if (tagError) throw tagError
  const { error } = await supabase.from('tags').delete().eq('id', labelId).eq('user_id', userId)
  if (error) throw error
}

export async function listProjectLabels(projectId: string) {
  const userId = await requireUserId()
  const { data: links, error } = await supabase
    .from('entity_tags')
    .select('tag_id')
    .eq('user_id', userId)
    .eq('entity_type', 'project')
    .eq('entity_id', projectId)
  if (error) throw error
  const tagIds = (links ?? []).map((row) => row.tag_id)
  if (!tagIds.length) return []
  const { data, error: tagsError } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .in('id', tagIds)
  if (tagsError) throw tagsError
  return (data ?? []) as Tag[]
}

export async function setProjectLabels(projectId: string, labelIds: string[]) {
  const userId = await requireUserId()
  const { error: delError } = await supabase
    .from('entity_tags')
    .delete()
    .eq('user_id', userId)
    .eq('entity_type', 'project')
    .eq('entity_id', projectId)
  if (delError) throw delError

  if (!labelIds.length) return []

  const rows = labelIds.map((tagId) => ({
    user_id: userId,
    tag_id: tagId,
    entity_type: 'project',
    entity_id: projectId,
  }))
  const { error: insertError } = await supabase.from('entity_tags').insert(rows)
  if (insertError) throw insertError
  return listProjectLabels(projectId)
}
