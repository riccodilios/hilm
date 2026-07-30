import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import type { Tables } from '@/types/database'
import type { ReminderType } from '@/features/tasks/reminders'

export const settingsKeys = {
  all: ['settings'] as const,
  me: () => [...settingsKeys.all, 'me'] as const,
  profile: () => ['profile', 'me'] as const,
}

const settingsSelect =
  'user_id, theme, default_model, notification_prefs, has_openrouter_key, default_reminder_type, email_reminders_enabled, push_notifications_enabled, onboarding_completed, default_startup_mode, created_at, updated_at'

export async function getSettings() {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_settings')
    .select(settingsSelect)
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return data as Omit<Tables<'user_settings'>, 'openrouter_api_key_encrypted'>
}

export async function updateSettings(patch: {
  theme?: string
  default_model?: string
  notification_prefs?: import('@/types/database').Json
  default_reminder_type?: ReminderType
  email_reminders_enabled?: boolean
  push_notifications_enabled?: boolean
  onboarding_completed?: boolean
  default_startup_mode?: import('@/types/database').Database['public']['Enums']['startup_mode']
}) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_settings')
    .update(patch)
    .eq('user_id', userId)
    .select(settingsSelect)
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
