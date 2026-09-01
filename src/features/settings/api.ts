export {
  getSettings,
  settingsKeys,
  updateSettings,
} from '@/shared/user-settings'
export { getProfile, updateProfile } from '@/shared/user-profile'
import { supabase } from '@/lib/supabase/client'
import { getAppUrl, getSupabaseAnonKey } from '@/lib/env'

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
