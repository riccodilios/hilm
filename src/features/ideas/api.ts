import { supabase } from '@/lib/supabase/client'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables } from '@/types/database'

export const ideasKeys = {
  all: ['ideas'] as const,
  list: (projectId?: string) => [...ideasKeys.all, 'list', projectId ?? 'all'] as const,
}

export async function listIdeas(projectId?: string) {
  let q = supabase.from('ideas').select('*').order('updated_at', { ascending: false })
  if (projectId) q = q.eq('project_id', projectId)
  const { data, error } = await q
  if (error) throw error
  return data as Tables<'ideas'>[]
}

export async function createIdea(input: {
  title: string
  description?: string
  projectId?: string | null
  impact?: number
  effort?: number
}) {
  const userId = await requireUserId()
  const payload: Inserts<'ideas'> = {
    user_id: userId,
    title: input.title,
    description: input.description ?? null,
    project_id: input.projectId ?? null,
    impact: input.impact ?? 3,
    effort: input.effort ?? 3,
  }
  const { data: created, error } = await supabase.from('ideas').insert(payload).select('id').maybeSingle()
  if (error) throw error
  if (!created?.id) throw new Error('Could not create idea')
  const { data, error: readError } = await supabase.from('ideas').select('*').eq('id', created.id).maybeSingle()
  if (readError) throw readError
  if (!data) throw new Error('Could not create idea')
  await recordActivity({
    userId,
    entityType: 'idea',
    entityId: data.id,
    projectId: data.project_id,
    action: 'created',
    summary: `Captured idea ${data.title}`,
  })
  return data as Tables<'ideas'>
}
