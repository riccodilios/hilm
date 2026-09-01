import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import type { Tables } from '@/types/database'

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
}

/** @deprecated Use profileKeys — kept for settings page compatibility. */
export const settingsKeys = {
  all: ['settings'] as const,
  me: () => [...settingsKeys.all, 'me'] as const,
  profile: () => profileKeys.me(),
}

export async function getProfile() {
  const userId = await requireUserId()
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  return data as Tables<'profiles'>
}

export async function updateProfile(patch: { display_name?: string; avatar_url?: string | null }) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single()
  if (error) throw error
  return data as Tables<'profiles'>
}
