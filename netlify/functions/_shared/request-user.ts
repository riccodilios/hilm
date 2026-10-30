/** Resolve the signed-in Supabase user behind a request's Bearer token (null when invalid). */
import { createClient } from '@supabase/supabase-js'

export type RequestUser = { id: string; email: string | null; emailConfirmed: boolean }

export function supabaseUrlFromEnv() {
  return process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
}

export async function requestUser(request: Request): Promise<RequestUser | null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const url = supabaseUrlFromEnv()
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    emailConfirmed: Boolean(data.user.email_confirmed_at),
  }
}

export const jsonResponse = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })
