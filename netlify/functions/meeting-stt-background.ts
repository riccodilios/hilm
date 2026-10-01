/**
 * Background (15 min) worker: uploads one finalized meeting to Soniox and creates its async
 * transcription job. Dispatched by meeting-process with the caller's JWT, so every database
 * write still runs under the user's RLS policies.
 */
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { loadOpenRouterKey } from './_shared/ai-guard'
import { loadMeeting, type EngineContext } from './_shared/meeting-engine'
import { resolveSonioxKey, submitSonioxJob } from './_shared/meeting-stt'

const bodySchema = z.object({
  os: z.enum(['personal', 'workspace']),
  meetingId: z.string().uuid(),
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

export default async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return new Response('Invalid request', { status: 400 })
    const { url, anonKey } = supabaseEnv()
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const sonioxKey = resolveSonioxKey()
    if (!url || !anonKey || !token || !sonioxKey) return new Response('Not configured', { status: 400 })

    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser(token)
    if (authError || !user) return new Response('Unauthorized', { status: 401 })

    const ctx: EngineContext = {
      client,
      os: parsed.data.os,
      apiKey: (await loadOpenRouterKey()) ?? '',
      sonioxKey,
      origin: new URL(request.url).origin,
      authToken: token,
    }
    const meeting = await loadMeeting(ctx, parsed.data.meetingId)
    if (!meeting) return new Response('Not found', { status: 404 })
    const outcome = await submitSonioxJob(ctx, meeting)
    return new Response(outcome, { status: 200 })
  } catch (error) {
    // Never throw: Netlify retries failed background runs, and the upload claim already guards
    // against a second upload. The advance loop falls back to Gemini if no job appears.
    console.error('meeting-stt-background error', error instanceof Error ? error.message.slice(0, 200) : 'unknown')
    return new Response('error', { status: 200 })
  }
}
