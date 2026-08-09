import { supabase } from '@/lib/supabase/client'
import { getAppUrl, getSupabaseAnonKey, getSupabaseUrl } from '@/lib/env'
import { coerceActionsList } from '@/features/ai/registry'
import { parseAiActions } from '@/types/ai-actions'
import type { AgentId } from '@/features/ai/agents'
import type { AiAction } from '@/types/ai-actions'
import type { Inserts, Tables } from '@/types/database'
import { formatAiLimitError } from '@/features/ai/lib/usage-errors'

export { formatAiLimitError } from '@/features/ai/lib/usage-errors'

function getAiChatUrl() {
  if (typeof window !== 'undefined') {
    const origin = window.location.origin.replace(/\/$/, '')
    // Production / Netlify preview: use Hilm's server-side OpenRouter key via Netlify.
    if (!/localhost|127\.0\.0\.1/i.test(origin)) {
      return `${origin}/api/ai-chat`
    }
  }
  const app = getAppUrl()
  if (app && !/localhost|127\.0\.0\.1/i.test(app)) return `${app.replace(/\/$/, '')}/api/ai-chat`
  // Local Vite: fall back to Supabase Edge (needs OPENROUTER_API_KEY secret there).
  return `${getSupabaseUrl()}/functions/v1/ai-chat`
}

export const aiKeys = {
  all: ['ai'] as const,
  conversations: (workspaceId?: string | null) =>
    [...aiKeys.all, 'conversations', workspaceId ?? 'personal'] as const,
  messages: (conversationId: string) => [...aiKeys.all, 'messages', conversationId] as const,
  usage: () => [...aiKeys.all, 'usage'] as const,
}

export type AiConversation = Tables<'ai_conversations'>
export type AiMessage = Tables<'ai_messages'>
export type ChatStreamEvent =
  | { type: 'token'; token: string }
  | { type: 'actions'; actions: AiAction[] }
  | { type: 'done'; content?: string; actions?: AiAction[] }
  | { type: 'error'; error: string; code?: string }

export type AiUsageSummary = {
  tier: string
  tier_name: string
  usage: {
    requests_day: number
    requests_month: number
    tokens_day: number
    tokens_month: number
    cost_day: number
    cost_month: number
  }
  limits: {
    requests_per_minute: number
    requests_per_day: number
    requests_per_month: number
    tokens_per_day: number
    tokens_per_month: number
    cost_usd_per_day: number
    cost_usd_per_month: number
    max_concurrent: number
  }
}

const inFlightFingerprints = new Set<string>()

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `ik_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function chatFingerprint(conversationId: string, message: string) {
  return `chat:${conversationId}:${message.trim().slice(0, 500)}`
}

export async function getAiUsageSummary() {
  const { data, error } = await supabase.rpc('get_ai_usage_summary')
  if (error) throw error
  return data as AiUsageSummary
}

export async function listConversations(workspaceId?: string | null) {
  let query = supabase.from('ai_conversations').select('*').order('updated_at', { ascending: false })
  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  } else {
    query = query.is('workspace_id', null)
  }
  const { data, error } = await query
  if (error) throw error
  return data as AiConversation[]
}

export async function createConversation(input: {
  title?: string
  agentId: AgentId
  projectId?: string
  workspaceId?: string
  model?: string
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const payload: Inserts<'ai_conversations'> = {
    user_id: user.id,
    title: input.title ?? 'New conversation',
    agent_id: input.agentId,
    project_id: input.projectId ?? null,
    workspace_id: input.workspaceId ?? null,
    model: input.model ?? null,
  }
  const { data, error } = await supabase.from('ai_conversations').insert(payload as never).select('*').single()
  if (error) throw error
  return data as AiConversation
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<AiConversation, 'title' | 'agent_id' | 'project_id' | 'model'>>,
) {
  const { data, error } = await supabase.from('ai_conversations').update(patch as never).eq('id', id).select('*').single()
  if (error) throw error
  return data as AiConversation
}

export async function deleteConversation(id: string) {
  const { error } = await supabase.from('ai_conversations').delete().eq('id', id)
  if (error) throw error
}

export async function listMessages(conversationId: string) {
  const { data, error } = await supabase
    .from('ai_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at')
  if (error) throw error
  return data as AiMessage[]
}

function parseActions(value: unknown, workspaceId?: string): AiAction[] {
  // Keep raw shapes for the UI even if OS validation is strict; AiPage re-validates on Apply.
  const strict = parseAiActions(value, workspaceId)
  if (strict.length) return strict
  return coerceActionsList(value) as AiAction[]
}

function parseSseEvent(raw: string, workspaceId?: string): ChatStreamEvent | null {
  const data = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
  if (!data || data === '[DONE]') return null

  try {
    const event = JSON.parse(data) as Record<string, unknown>
    if (event.type === 'token' && typeof event.token === 'string') return { type: 'token', token: event.token }
    if (event.type === 'actions') return { type: 'actions', actions: parseActions(event.actions, workspaceId) }
    if (event.type === 'done') {
      return {
        type: 'done',
        content: typeof event.content === 'string' ? event.content : undefined,
        actions: parseActions(event.actions, workspaceId),
      }
    }
    if (event.type === 'error') {
      return {
        type: 'error',
        error: formatAiLimitError({
          error: String(event.error ?? 'AI request failed'),
          code: typeof event.code === 'string' ? event.code : undefined,
        }),
        code: typeof event.code === 'string' ? event.code : undefined,
      }
    }
  } catch {
    return { type: 'token', token: data }
  }
  return null
}

export function clientAiClock() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    clientNow: now.toISOString(),
    clientLocalDate: `${y}-${m}-${d}`,
  }
}

export async function* streamChat(input: {
  conversationId: string
  message: string
  agentId: AgentId
  projectId?: string
  workspaceId?: string
  model?: string
  locale?: string
  timezone?: string
  clientNow?: string
  clientLocalDate?: string
  idempotencyKey?: string
  conversationFocus?: {
    lastCreatedTaskId?: string | null
    lastModifiedTaskId?: string | null
    lastReferencedProjectId?: string | null
    lastReferencedWorkspaceId?: string | null
    lastTaskTitle?: string | null
  }
}): AsyncGenerator<ChatStreamEvent> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    yield { type: 'error', error: 'Not authenticated' }
    return
  }

  const message = input.message.trim()
  const fingerprint = chatFingerprint(input.conversationId, message)
  if (inFlightFingerprints.has(fingerprint)) {
    yield {
      type: 'error',
      error: formatAiLimitError({ code: 'duplicate_execution' }),
      code: 'duplicate_execution',
    }
    return
  }

  const idempotencyKey = input.idempotencyKey?.trim() || newIdempotencyKey()
  inFlightFingerprints.add(fingerprint)
  const clock = clientAiClock()

  try {
    const response = await fetch(getAiChatUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: getSupabaseAnonKey(),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        ...input,
        message,
        idempotencyKey,
        fingerprint,
        timezone: clock.timezone,
        clientNow: clock.clientNow,
        clientLocalDate: clock.clientLocalDate,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      try {
        const payload = JSON.parse(text) as { error?: string; code?: string }
        throw Object.assign(new Error(formatAiLimitError(payload)), { code: payload.code })
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(text || 'AI request failed')
        throw error
      }
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') || !response.body) {
      const payload = (await response.json()) as {
        content?: string
        actions?: unknown
        error?: string
        code?: string
      }
      if (payload.error) {
        yield { type: 'error', error: formatAiLimitError(payload), code: payload.code }
        return
      }
      if (payload.content) yield { type: 'token', token: payload.content }
      const actions = parseActions(payload.actions, input.workspaceId)
      if (actions.length) yield { type: 'actions', actions }
      yield { type: 'done', content: payload.content, actions }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''
      for (const raw of events) {
        const event = parseSseEvent(raw, input.workspaceId)
        if (event) yield event
      }
      if (done) break
    }
    const finalEvent = parseSseEvent(buffer, input.workspaceId)
    if (finalEvent) yield finalEvent
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : undefined
    yield {
      type: 'error',
      error: error instanceof Error ? error.message : 'AI request failed',
      code,
    }
  } finally {
    inFlightFingerprints.delete(fingerprint)
  }
}
