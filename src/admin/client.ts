/**
 * Admin console client. Separate Supabase client: the session lives in sessionStorage under its
 * own key (closing the tab signs out) and is never shared with the product app.
 */
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/env'

export const adminSupabase = createClient(getSupabaseUrl() || 'https://placeholder.supabase.co', getSupabaseAnonKey() || 'placeholder', {
  auth: {
    storageKey: 'hilm-console-auth',
    storage: sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

export class AdminApiError extends Error {
  status: number
  code: string
  data: Record<string, unknown>
  constructor(status: number, code: string, data: Record<string, unknown>) {
    super(code)
    this.status = status
    this.code = code
    this.data = data
  }
}

/** Set by the shell: asks for a fresh authenticator code, resolves true when verified. */
let reauthenticate: (() => Promise<boolean>) | null = null
export function setReauthHandler(handler: (() => Promise<boolean>) | null) {
  reauthenticate = handler
}

export async function adminApi<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}, retried = false): Promise<T> {
  const { data } = await adminSupabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AdminApiError(401, 'unauthorized', {})
  const response = await fetch(`/api/admin/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) return payload as T
  const code = typeof payload.error === 'string' ? payload.error : 'request_failed'
  if (code === 'reauth_required' && !retried && reauthenticate && (await reauthenticate())) {
    return adminApi<T>(path, init, true)
  }
  throw new AdminApiError(response.status, code, payload)
}

export const usd = (value: unknown) =>
  `$${Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`

export const when = (value: unknown) => (value ? new Date(String(value)).toLocaleString() : '—')
