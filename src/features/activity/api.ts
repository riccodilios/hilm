import { supabase } from '@/lib/supabase/client'
import type { Tables } from '@/types/database'

export const activityKeys = {
  all: ['activity'] as const,
  feed: (limit = 30) => [...activityKeys.all, 'feed', limit] as const,
  byProject: (projectId: string) => [...activityKeys.all, 'project', projectId] as const,
}

export async function listActivity(limit = 30, projectId?: string) {
  let q = supabase
    .from('activity_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (projectId) q = q.eq('project_id', projectId)
  const { data, error } = await q
  if (error) throw error
  return data as Tables<'activity_events'>[]
}
