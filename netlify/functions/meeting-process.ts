import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { aiCorsHeaders, aiJson, loadOpenRouterKey } from './_shared/ai-guard'
import {
  advanceMeeting,
  loadMeeting,
  retryMeeting,
  transcribeSegment,
  type EngineContext,
  type StepResult,
} from './_shared/meeting-engine'
import { translateMeeting } from './_shared/meeting-translator'

const osSchema = z.enum(['personal', 'workspace'])
const localeFields = {
  locale: z.string().max(16).optional(),
  timeZone: z.string().max(64).optional(),
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('transcribe_segment'),
    os: osSchema,
    meetingId: z.string().uuid(),
    idx: z.number().int().min(0).max(2000),
    ...localeFields,
  }),
  z.object({
    action: z.literal('advance'),
    os: osSchema,
    meetingId: z.string().uuid(),
    ...localeFields,
  }),
  z.object({
    action: z.literal('retry'),
    os: osSchema,
    meetingId: z.string().uuid(),
    ...localeFields,
  }),
  z.object({
    action: z.literal('translate'),
    os: osSchema,
    meetingId: z.string().uuid(),
    target: z.enum(['en', 'ar']),
    ...localeFields,
  }),
])

function supabaseEnv() {
  const url =
    process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  return { url, anonKey }
}

function stepResponse(result: StepResult, json: (data: unknown, status?: number) => Response) {
  if (result.ok) return json({ ok: true, state: result.state, more: result.more })
  return json({ ok: false, code: result.code, error: result.message }, result.status)
}

async function meetingMaxRetries(client: SupabaseClient) {
  const { data } = await client.rpc('meeting_quota_status', { p_user_id: null })
  const value = Number((data as { max_retries?: number } | null)?.max_retries)
  return Number.isFinite(value) ? value : 3
}

export default async (request: Request) => {
  const json = (data: unknown, status = 200) => aiJson(data, status, request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: aiCorsHeaders(request) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const parsedBody = bodySchema.safeParse(rawBody)
  if (!parsedBody.success) return json({ error: 'Invalid request' }, 400)
  const body = parsedBody.data

  const { url: supabaseUrl, anonKey } = supabaseEnv()
  if (!supabaseUrl || !anonKey) return json({ error: 'Server is not configured' }, 500)

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Missing authorization token' }, 401)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const apiKey = await loadOpenRouterKey()
    if (!apiKey) return json({ error: 'AI is not configured on the server' }, 500)

    const ctx: EngineContext = {
      client: userClient,
      os: body.os,
      apiKey,
      locale: body.locale?.startsWith('ar') ? 'ar' : 'en',
      timeZone: body.timeZone?.trim() || null,
    }
    const meeting = await loadMeeting(ctx, body.meetingId)
    if (!meeting) return json({ error: 'Meeting not found' }, 404)

    if (body.action === 'transcribe_segment') {
      return stepResponse(await transcribeSegment(ctx, meeting, body.idx), json)
    }
    if (body.action === 'translate') {
      const result = await translateMeeting(ctx, meeting, body.target)
      if (!result.ok) return json({ ok: false, code: result.code, error: result.message }, result.status)
      return json(result)
    }
    if (body.action === 'retry') {
      const maxRetries = await meetingMaxRetries(userClient)
      const result = await retryMeeting(ctx, meeting, maxRetries)
      if (!result.ok) return stepResponse(result, json)
      const fresh = (await loadMeeting(ctx, meeting.id)) ?? meeting
      return stepResponse(await advanceMeeting(ctx, fresh), json)
    }
    return stepResponse(await advanceMeeting(ctx, meeting), json)
  } catch (error) {
    console.error('meeting-process error', error instanceof Error ? error.message : error)
    return json({ error: 'Meeting processing failed' }, 500)
  }
}
