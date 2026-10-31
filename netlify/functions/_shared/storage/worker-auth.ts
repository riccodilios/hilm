/**
 * Session for the storage worker service account. Hilm has no Supabase service-role key on the
 * server; the worker instead signs in as a dedicated account whose only extra rights are the
 * storage_worker_* policies (read and delete objects in the attachments and meeting-audio buckets).
 * Credentials: STORAGE_WORKER_EMAIL / STORAGE_WORKER_PASSWORD (server env only).
 */
type CachedToken = { token: string; expiresAt: number }

let cached: CachedToken | null = null

export type WorkerAuthConfig = {
  supabaseUrl: string
  anonKey: string
  email: string
  password: string
}

export function workerAuthConfig(env: Record<string, string | undefined> = process.env): WorkerAuthConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  const email = env.STORAGE_WORKER_EMAIL
  const password = env.STORAGE_WORKER_PASSWORD
  if (!supabaseUrl || !anonKey || !email || !password) return null
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), anonKey, email, password }
}

export async function storageWorkerToken(config: WorkerAuthConfig, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.email, password: config.password }),
  })
  if (!response.ok) {
    cached = null
    throw new Error(`storage worker sign-in failed (${response.status})`)
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error('storage worker sign-in returned no token')
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return cached.token
}

export function resetStorageWorkerToken() {
  cached = null
}
