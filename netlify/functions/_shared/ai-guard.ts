import type { SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'

export type AiRequestKind = 'chat' | 'daily_log'

export type AiGuardResult = {
  ok: boolean
  code?: string
  message?: string
  event_id?: string
  status?: string
  tier?: string
  usage?: Record<string, number>
  limits?: Record<string, number>
}

export type AiUsageTokens = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

const CORS_HEADERS = {
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, idempotency-key, x-idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
  Vary: 'Origin',
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://hillm.netlify.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

function allowedOrigins() {
  const fromEnv = (process.env.APP_URL || process.env.VITE_APP_URL || '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv])
}

export function aiCorsHeaders(request?: Request) {
  const origin = request?.headers.get('origin') || ''
  const allowed = allowedOrigins()
  const headers: Record<string, string> = { ...CORS_HEADERS }
  if (origin && allowed.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  } else if (!origin) {
    // Same-origin / non-browser clients
    headers['Access-Control-Allow-Origin'] = allowed.values().next().value || 'https://hillm.netlify.app'
  }
  return headers
}

export function aiJson(data: unknown, status = 200, request?: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...aiCorsHeaders(request),
    },
  })
}

export function aiLimitStatus(code?: string) {
  if (!code) return 429
  if (code === 'duplicate' || code === 'duplicate_execution' || code === 'in_flight') return 409
  if (code === 'tier_disabled') return 403
  return 429
}

export function friendlyAiLimitPayload(guard: AiGuardResult) {
  return {
    error: guard.message || 'AI usage limit reached',
    code: guard.code || 'ai_limit',
    tier: guard.tier,
    usage: guard.usage,
    limits: guard.limits,
  }
}

export async function loadOpenRouterKey() {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim()
  if (fromEnv) return fromEnv

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  })
  try {
    await client.connect()
    const { rows } = await client.query<{ value: string }>(
      `select value from private.server_secrets where key = 'OPENROUTER_API_KEY' limit 1`,
    )
    return rows[0]?.value?.trim() || null
  } finally {
    await client.end().catch(() => undefined)
  }
}

export async function beginAiRequest(
  client: SupabaseClient,
  input: {
    requestKind: AiRequestKind
    model?: string | null
    workspaceId?: string | null
    conversationId?: string | null
    idempotencyKey?: string | null
    fingerprint?: string | null
    userId?: string | null
  },
): Promise<AiGuardResult> {
  const { data, error } = await client.rpc('begin_ai_request', {
    p_request_kind: input.requestKind,
    p_model: input.model ?? null,
    p_workspace_id: input.workspaceId ?? null,
    p_conversation_id: input.conversationId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_fingerprint: input.fingerprint ?? null,
    p_user_id: input.userId ?? null,
  })
  if (error) {
    return {
      ok: false,
      code: 'guard_error',
      message: error.message || 'Could not start AI request protection',
    }
  }
  return (data ?? { ok: false, code: 'guard_error', message: 'Empty guard response' }) as AiGuardResult
}

export async function completeAiRequest(
  client: SupabaseClient,
  input: {
    eventId: string
    status: 'completed' | 'failed'
    inputTokens?: number
    outputTokens?: number
    model?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    userId?: string | null
  },
) {
  const { error } = await client.rpc('complete_ai_request', {
    p_event_id: input.eventId,
    p_status: input.status,
    p_input_tokens: input.inputTokens ?? 0,
    p_output_tokens: input.outputTokens ?? 0,
    p_model: input.model ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_user_id: input.userId ?? null,
  })
  if (error) {
    console.error('complete_ai_request failed', error.message)
  }
}

export function tokensFromOpenRouterUsage(usage: unknown): AiUsageTokens {
  const u = (usage ?? {}) as {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
  const inputTokens = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0
  const outputTokens = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0
  const totalTokens = Number(u.total_tokens ?? inputTokens + outputTokens) || inputTokens + outputTokens
  return { inputTokens, outputTokens, totalTokens }
}

export function estimateTokensFromText(text: string) {
  // Rough fallback when provider omits usage (~4 chars/token).
  return Math.max(1, Math.ceil((text || '').length / 4))
}
