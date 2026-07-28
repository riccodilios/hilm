import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import type { Tables } from '@/types/database'

export const settingsKeys = {
  all: ['settings'] as const,
  me: () => [...settingsKeys.all, 'me'] as const,
  profile: () => ['profile', 'me'] as const,
}

export async function getSettings() {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_settings')
    .select('user_id, theme, default_model, notification_prefs, has_openrouter_key, created_at, updated_at')
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return data as Omit<Tables<'user_settings'>, 'openrouter_api_key_encrypted'>
}

export async function updateSettings(patch: {
  theme?: string
  default_model?: string
  notification_prefs?: import('@/types/database').Json
}) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_settings')
    .update(patch)
    .eq('user_id', userId)
    .select('user_id, theme, default_model, notification_prefs, has_openrouter_key, created_at, updated_at')
    .single()
  if (error) throw error
  return data
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

export async function saveOpenRouterKey(apiKey: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/encrypt-key`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({ apiKey }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Failed to save API key')
  }
  return res.json()
}
