/**
 * Public meeting link resolver. Anyone holding a valid share token gets the meeting's shared
 * payload (an explicit allow-list built by get_shared_meeting). A signed-in caller who can already
 * open the meeting privately also gets its in-app address. The token is never logged.
 */
import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const bodySchema = z.object({ token: z.string().max(200) })

const linkSchema = z.object({
  os: z.enum(['personal', 'workspace']),
  meeting_id: z.string().uuid(),
  project_id: z.string().uuid(),
  workspace_id: z.string().uuid().optional(),
})

function supabaseEnv() {
  const url =
    process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  return { url, anonKey }
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Meeting content must never be stored by shared caches or indexed.
      'Cache-Control': 'private, no-store, max-age=0',
      Vary: 'Authorization',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })

export function appHrefFor(link: z.infer<typeof linkSchema>) {
  return link.os === 'workspace'
    ? `/workspace/${link.workspace_id}/projects/${link.project_id}/meetings/${link.meeting_id}`
    : `/personal/projects/${link.project_id}/meetings/${link.meeting_id}`
}

export default async (request: Request) => {
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' })
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  // Malformed, unknown, revoked and deleted links all look the same to the caller.
  if (!body.success || !TOKEN_RE.test(body.data.token)) return reply(404, { error: 'not_found' })
  const token = body.data.token

  const { url, anonKey } = supabaseEnv()
  if (!url || !anonKey) return reply(500, { error: 'Server is not configured' })

  try {
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await anon.rpc('get_shared_meeting', { p_token: token })
    if (error) {
      console.error('meeting-share lookup failed', error.message.slice(0, 200))
      return reply(500, { error: 'lookup_failed' })
    }
    if (!data || typeof data !== 'object') return reply(404, { error: 'not_found' })

    let appHref: string | null = null
    const jwt = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (jwt) {
      const user = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      // Only resolves when the caller can already open the meeting privately (RLS semantics).
      const link = await user.rpc('shared_meeting_app_link', { p_token: token })
      const parsed = link.error ? null : linkSchema.safeParse(link.data)
      if (parsed?.success) appHref = appHrefFor(parsed.data)
    }
    return reply(200, { ok: true, meeting: data, appHref })
  } catch (error) {
    console.error('meeting-share error', error instanceof Error ? error.message.slice(0, 200) : 'unknown')
    return reply(500, { error: 'lookup_failed' })
  }
}

export const config: Config = {
  path: '/api/meeting-share',
  // 256-bit tokens cannot be guessed; this only caps scraping and abuse per client.
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
