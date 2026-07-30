/**
 * Shared AI guard helpers for Supabase Edge (mirrors Netlify _shared/ai-guard).
 */
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

// deno-lint-ignore no-explicit-any
type AnyClient = { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }> }

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

export async function beginAiRequest(
  client: AnyClient,
  input: {
    requestKind: 'chat' | 'daily_log'
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
  client: AnyClient,
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
  if (error) console.error('complete_ai_request failed', error.message)
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
  return Math.max(1, Math.ceil((text || '').length / 4))
}
