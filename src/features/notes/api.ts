import { supabase } from '@/lib/supabase/client'
import { recordActivity } from '@/features/activity/record'
import { requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables } from '@/types/database'

export const notesKeys = {
  all: ['notes'] as const,
  list: (projectId?: string) => [...notesKeys.all, 'list', projectId ?? 'all'] as const,
  detail: (id: string) => [...notesKeys.all, 'detail', id] as const,
}

export async function listNotes(projectId?: string) {
  let q = supabase.from('notes').select('*').order('updated_at', { ascending: false })
  if (projectId) q = q.eq('project_id', projectId)
  const { data, error } = await q
  if (error) throw error
  return data as Tables<'notes'>[]
}

export async function getNote(id: string) {
  const { data, error } = await supabase.from('notes').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Note not found')
  return data as Tables<'notes'>
}

export async function createNote(input: {
  title: string
  body?: string
  projectId?: string | null
}) {
  const userId = await requireUserId()
  const payload: Inserts<'notes'> = {
    user_id: userId,
    title: input.title,
    body: input.body ?? '',
    project_id: input.projectId ?? null,
  }
  const { data: created, error } = await supabase.from('notes').insert(payload).select('id').maybeSingle()
  if (error) throw error
  if (!created?.id) throw new Error('Could not create note')
  const data = await getNote(created.id)
  await recordActivity({
    userId,
    entityType: 'note',
    entityId: data.id,
    projectId: data.project_id,
    action: 'created',
    summary: `Created note ${data.title}`,
  })
  return data
}

export async function updateNote(
  id: string,
  patch: { title?: string; body?: string; project_id?: string | null },
) {
  const userId = await requireUserId()
  const { error } = await supabase.from('notes').update(patch).eq('id', id)
  if (error) throw error
  const data = await getNote(id)
  await recordActivity({
    userId,
    entityType: 'note',
    entityId: id,
    projectId: data.project_id,
    action: 'updated',
    summary: `Updated note ${data.title}`,
  })
  return data
}
