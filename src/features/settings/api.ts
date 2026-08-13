import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { getAppUrl, getSupabaseAnonKey } from '@/lib/env'
import type { Tables } from '@/types/database'
import type { ReminderType } from '@/features/tasks/reminders'

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

/** Permanently delete the signed-in account via Netlify function (requires typing DELETE). */
export async function deleteAccount(confirm: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const origin =
    typeof window !== 'undefined' && !/localhost|127\.0\.0\.1/i.test(window.location.origin)
      ? window.location.origin
      : getAppUrl() || (typeof window !== 'undefined' ? window.location.origin : '')

  const response = await fetch(`${origin.replace(/\/$/, '')}/api/delete-account`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: getSupabaseAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirm }),
  })

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
    code?: string
    workspaces?: Array<{ id: string; name: string }>
  }

  if (!response.ok) {
    const err = new Error(payload.error || 'Could not delete account') as Error & {
      code?: string
      workspaces?: Array<{ id: string; name: string }>
    }
    err.code = payload.code
    err.workspaces = payload.workspaces
    throw err
  }
}
