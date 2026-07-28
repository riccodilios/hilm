import { supabase } from '@/lib/supabase/client'
import { aiActionsArraySchema } from '@/types/ai-actions'
import type { AgentId } from '@/features/ai/agents'
import type { AiAction } from '@/types/ai-actions'
import type { Inserts, Tables } from '@/types/database'

export const aiKeys = {
  all: ['ai'] as const,
  conversations: () => [...aiKeys.all, 'conversations'] as const,
  messages: (conversationId: string) => [...aiKeys.all, 'messages', conversationId] as const,
}

export type AiConversation = Tables<'ai_conversations'>
export type AiMessage = Tables<'ai_messages'>
export type ChatStreamEvent =
  | { type: 'token'; token: string }
  | { type: 'actions'; actions: AiAction[] }
  | { type: 'done'; content?: string; actions?: AiAction[] }
  | { type: 'error'; error: string }

export async function listConversations() {
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data as AiConversation[]
}

export async function createConversation(input: {
  title?: string
  agentId: AgentId
  projectId?: string
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

function parseActions(value: unknown): AiAction[] {
  const parsed = aiActionsArraySchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

function parseSseEvent(raw: string): ChatStreamEvent | null {
  const data = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
  if (!data || data === '[DONE]') return null

  try {
    const event = JSON.parse(data) as Record<string, unknown>
    if (event.type === 'token' && typeof event.token === 'string') return { type: 'token', token: event.token }
    if (event.type === 'actions') return { type: 'actions', actions: parseActions(event.actions) }
    if (event.type === 'done') {
      return {
        type: 'done',
        content: typeof event.content === 'string' ? event.content : undefined,
        actions: parseActions(event.actions),
      }
    }
    if (event.type === 'error') return { type: 'error', error: String(event.error ?? 'AI request failed') }
  } catch {
    return { type: 'token', token: data }
  }
  return null
}

export async function* streamChat(input: {
  conversationId: string
  message: string
  agentId: AgentId
  projectId?: string
  model?: string
  locale?: string
}): AsyncGenerator<ChatStreamEvent> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    yield { type: 'error', error: 'Not authenticated' }
    return
  }

  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error((await response.text()) || 'AI request failed')

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') || !response.body) {
      const payload = (await response.json()) as { content?: string; actions?: unknown; error?: string }
      if (payload.error) {
        yield { type: 'error', error: payload.error }
        return
      }
      if (payload.content) yield { type: 'token', token: payload.content }
      const actions = parseActions(payload.actions)
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
        const event = parseSseEvent(raw)
        if (event) yield event
      }
      if (done) break
    }
    const finalEvent = parseSseEvent(buffer)
    if (finalEvent) yield finalEvent
  } catch (error) {
    yield { type: 'error', error: error instanceof Error ? error.message : 'AI request failed' }
  }
}
