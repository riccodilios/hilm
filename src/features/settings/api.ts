export {
  getSettings,
  settingsKeys,
  updateSettings,
} from '@/shared/user-settings'
export { getProfile, updateProfile } from '@/shared/user-profile'
import { supabase } from '@/lib/supabase/client'
import { getAppUrl, getSupabaseAnonKey } from '@/lib/env'

export type BroadcastContent = {
  subject: string
  preheader?: string
  heading: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
}

export type BroadcastAdminInfo =
  | { admin: false }
  | {
      admin: true
      sendingEnabled: boolean
      audience: { all: number; en: number; ar: number }
      recent: Array<{ id: string; created_at: string; audience: string; recipients: number; subject: string | null }>
    }

async function emailAdminRequest<T>(method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const response = await fetch('/api/admin-email', {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    const err = new Error(payload.error || 'request_failed') as Error & { code?: string }
    err.code = payload.error
    throw err
  }
  return payload
}

export const getBroadcastAdmin = () => emailAdminRequest<BroadcastAdminInfo>('GET')

export const submitBroadcast = (body: {
  action: 'preview' | 'test' | 'send'
  audience: 'all' | 'en' | 'ar'
  content: Partial<Record<'en' | 'ar', BroadcastContent>>
  confirm?: string
}) =>
  emailAdminRequest<{ html?: Partial<Record<'en' | 'ar', string>>; tested?: string[]; queued?: number }>('POST', body)

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
