import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const actionInstruction =
  'When an action would help, finish with a fenced ```actions json block containing a JSON array. Allowed types: task.complete, task.create, task.move, task.update, project.create, project.update, note.create, roadmap.create, daily_log.upsert, activity.note, idea.create. Use UUIDs only when present in context.'

const agentPrompts: Record<string, string> = {
  chief_of_staff: `You are Hilm's Chief of Staff. Prioritize outcomes and identify the most valuable next steps. Be concise and decisive. ${actionInstruction}`,
  project_manager: `You are Hilm's Project Manager. Assess scope, milestones, risks, and delivery progress. ${actionInstruction}`,
  task_manager: `You are Hilm's Task Manager. Turn work into small, concrete, properly sequenced tasks. ${actionInstruction}`,
  documentation_writer: `You are Hilm's Documentation Writer. Write clear, audience-appropriate documentation. ${actionInstruction}`,
  planning_assistant: `You are Hilm's Planning Assistant. Create realistic plans with dependencies and milestones. ${actionInstruction}`,
  architecture_advisor: `You are Hilm's Architecture Advisor. Explain technical trade-offs, constraints, and design options. ${actionInstruction}`,
  meeting_summarizer: `You are Hilm's Meeting Summarizer. Summarize decisions, open questions, and follow-up items. ${actionInstruction}`,
  qa_assistant: `You are Hilm's QA Assistant. Create focused test plans, edge cases, and release-risk assessments. ${actionInstruction}`,
}

function toBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function fromBytes(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

async function decryptKey(value: string, secret?: string) {
  if (value.startsWith('base64:')) return decoder.decode(toBytes(value.slice(7)))
  if (!value.startsWith('aes-gcm:')) throw new Error('Unsupported API key format')
  if (!secret) throw new Error('ENCRYPTION_SECRET is required to decrypt the API key')
  const combined = toBytes(value.slice(8))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
  return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext))
}

function actionsFromContent(content: string) {
  const match = content.match(/```actions(?:\s+json)?\s*\n([\s\S]*?)```/i)
  if (!match) return []
  try {
    const actions = JSON.parse(match[1])
    return Array.isArray(actions) ? actions : []
  } catch {
    return []
  }
}

function sse(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) throw new Error('Missing authorization token')
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) throw new Error('Unauthorized')

    const body = await request.json() as {
      conversationId?: string
      message?: string
      agentId?: string
      projectId?: string
      model?: string
    }
    if (!body.conversationId || !body.message?.trim()) throw new Error('conversationId and message are required')

    const admin = createClient(url, serviceKey)
    const { data: conversation, error: conversationError } = await admin
      .from('ai_conversations')
      .select('id, project_id, model')
      .eq('id', body.conversationId)
      .eq('user_id', user.id)
      .single()
    if (conversationError || !conversation) throw new Error('Conversation not found')

    const { data: settings, error: settingsError } = await admin
      .from('user_settings')
      .select('openrouter_api_key_encrypted, default_model')
      .eq('user_id', user.id)
      .single()
    if (settingsError || !settings?.openrouter_api_key_encrypted) throw new Error('Add an OpenRouter API key in Settings first')

    const apiKey = await decryptKey(settings.openrouter_api_key_encrypted, Deno.env.get('ENCRYPTION_SECRET'))
    const activeProjectId = body.projectId ?? conversation.project_id
    const [{ data: history }, { data: projects }, { data: tasks }] = await Promise.all([
      admin.from('ai_messages').select('role, content').eq('conversation_id', body.conversationId).order('created_at', { ascending: false }).limit(16),
      admin.from('projects').select('id, name, description, completion_pct, health').eq('user_id', user.id).neq('status', 'archived').limit(12),
      admin.from('tasks').select('id, title, status, priority, due_at, project_id').eq('user_id', user.id).neq('status', 'archived').order('due_at', { ascending: true, nullsFirst: false }).limit(20),
    ])
    const scopedTasks = activeProjectId ? (tasks ?? []).filter((task) => task.project_id === activeProjectId) : tasks ?? []
    const agentInstruction = agentPrompts[body.agentId ?? 'chief_of_staff'] ?? agentPrompts.chief_of_staff
    const systemPrompt = `You are Hilm AI. ${agentInstruction}
Respond in helpful, concise Markdown. When you propose executable changes, append exactly one fenced \`\`\`actions JSON block at the end, for example:
\`\`\`actions
[{"type":"task.create","title":"Example","priority":"medium"}]
\`\`\`
Valid action types and fields: task.complete {taskId}; task.create {title,description?,projectId?,priority?,status?,dueAt?}; task.move {taskId,status}; task.update {taskId,title?,description?,priority?,dueAt?}; project.create {name,description?,color?,icon?}; project.update {projectId,name?,description?,completionPct?,health?}; note.create {title,body?,projectId?}; roadmap.create {projectId,title,horizon?,description?}; daily_log.upsert {logDate?,workedOn?,blockers?,hours?,wins?,tomorrow?,aiSummary?}; activity.note {summary,entityType?,entityId?,projectId?}; idea.create {title,description?,projectId?,impact?,effort?}. Only use IDs in the provided context. Do not include an actions block when no action is useful.
Context pack:
Projects: ${JSON.stringify(projects ?? [])}
Tasks: ${JSON.stringify(scopedTasks)}`
    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://hilm.app',
        'X-Title': 'Hilm',
      },
      body: JSON.stringify({
        model: body.model ?? conversation.model ?? settings.default_model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...(history ?? []).reverse().map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: body.message.trim() },
        ],
      }),
    })
    if (!openRouterResponse.ok || !openRouterResponse.body) {
      throw new Error((await openRouterResponse.text()) || 'OpenRouter request failed')
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = openRouterResponse.body!.getReader()
        let buffer = ''
        let content = ''
        try {
          while (true) {
            const { done, value } = await reader.read()
            buffer += decoder.decode(value, { stream: !done })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data:')) continue
              const data = line.slice(5).trim()
              if (!data || data === '[DONE]') continue
              try {
                const chunk = JSON.parse(data)
                const token = chunk.choices?.[0]?.delta?.content
                if (typeof token === 'string') {
                  content += token
                  controller.enqueue(encoder.encode(sse({ type: 'token', token })))
                }
              } catch {
                // Ignore malformed provider chunks and continue streaming.
              }
            }
            if (done) break
          }
          const actions = actionsFromContent(content)
          await admin.from('ai_messages').insert([
            { user_id: user.id, conversation_id: body.conversationId, role: 'user', content: body.message.trim(), actions: [] },
            { user_id: user.id, conversation_id: body.conversationId, role: 'assistant', content, actions, model: body.model ?? conversation.model ?? settings.default_model },
          ])
          await admin.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', body.conversationId)
          if (actions.length) controller.enqueue(encoder.encode(sse({ type: 'actions', actions })))
          controller.enqueue(encoder.encode(sse({ type: 'done', content, actions })))
        } catch (error) {
          controller.enqueue(encoder.encode(sse({ type: 'error', error: error instanceof Error ? error.message : 'Streaming failed' })))
        } finally {
          controller.close()
        }
      },
    })
    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'AI request failed' },
      { status: 400, headers: corsHeaders },
    )
  }
})
