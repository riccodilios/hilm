import { supabase } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export async function recordActivity(input: {
  userId: string
  entityType: string
  entityId?: string | null
  projectId?: string | null
  action: string
  summary: string
  metadata?: Json
}) {
  const { error } = await supabase.from('activity_events').insert({
    user_id: input.userId,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    project_id: input.projectId ?? null,
    action: input.action,
    summary: input.summary,
    metadata: input.metadata ?? {},
  })

  if (error) {
    console.error('Failed to record activity', error)
  }
}
