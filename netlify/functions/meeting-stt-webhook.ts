/**
 * Soniox async STT webhook. Only a signal: it records that the job finished so the next advance
 * re-checks the job with Soniox immediately. The per-job secret header is verified (hashed) inside
 * the meeting_stt_webhook RPC; the payload itself is never trusted for transcript content.
 */
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { SONIOX_WEBHOOK_HEADER } from './_shared/meeting-soniox'

const querySchema = z.object({
  os: z.enum(['personal', 'workspace']),
  meeting: z.string().uuid(),
})

const bodySchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(['completed', 'error']),
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
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export default async (request: Request) => {
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' })

  const token = request.headers.get(SONIOX_WEBHOOK_HEADER)?.trim() ?? ''
  if (token.length < 32 || token.length > 256) return reply(401, { error: 'Unauthorized' })

  const params = new URL(request.url).searchParams
  const query = querySchema.safeParse({ os: params.get('os'), meeting: params.get('meeting') })
  if (!query.success) return reply(400, { error: 'Invalid request' })
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return reply(400, { error: 'Invalid request' })

  const { url, anonKey } = supabaseEnv()
  if (!url || !anonKey) return reply(500, { error: 'Server is not configured' })

  try {
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.rpc('meeting_stt_webhook', {
      p_os: query.data.os,
      p_meeting_id: query.data.meeting,
      p_job_id: body.data.id,
      p_token: token,
      p_status: body.data.status,
    })
    if (error) {
      console.error('meeting-stt-webhook rpc error', error.message.slice(0, 200))
      return reply(500, { error: 'Webhook processing failed' })
    }
    // Unknown/mismatched job or token: reject without revealing which check failed.
    if (data !== true) return reply(401, { error: 'Unauthorized' })
    return reply(200, { ok: true })
  } catch (error) {
    console.error('meeting-stt-webhook error', error instanceof Error ? error.message.slice(0, 200) : 'unknown')
    return reply(500, { error: 'Webhook processing failed' })
  }
}
