import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import type { Tables } from '@/types/database'
import type { ReminderType } from '@/shared/reminders'

export const settingsKeys = {
  all: ['settings'] as const,
  me: () => [...settingsKeys.all, 'me'] as const,
  profile: () => ['profile', 'me'] as const,
}

const settingsSelect =
  'user_id, theme, default_model, notification_prefs, has_openrouter_key, default_reminder_type, email_reminders_enabled, push_notifications_enabled, onboarding_completed, default_startup_mode, hide_workspace_os, hide_personal_os, time_format, last_seen_announcement_version, created_at, updated_at'

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
  notification_prefs?: Tables<'user_settings'>['notification_prefs']
  default_reminder_type?: ReminderType
  email_reminders_enabled?: boolean
  push_notifications_enabled?: boolean
  onboarding_completed?: boolean
  default_startup_mode?: Tables<'user_settings'>['default_startup_mode']
  hide_workspace_os?: boolean
  hide_personal_os?: boolean
  time_format?: '12h' | '24h'
  last_seen_announcement_version?: string | null
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
