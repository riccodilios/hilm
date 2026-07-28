import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

async function loadOpenRouterKey() {
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

export default async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Missing authorization token' }, 401)

    const supabaseUrl =
      process.env.VITE_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL
    const anonKey =
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) {
      return json({ error: 'Supabase URL/anon key missing on Netlify' }, 500)
    }

    const apiKey = await loadOpenRouterKey()
    if (!apiKey) {
      return json({ error: 'Hilm OpenRouter key is not configured on the server' }, 500)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const body = (await request.json()) as {
      conversationId?: string
      message?: string
      agentId?: string
      projectId?: string
      model?: string
      locale?: string
    }
    if (!body.conversationId || !body.message?.trim()) {
      return json({ error: 'conversationId and message are required' }, 400)
    }

    const { data: conversation, error: conversationError } = await userClient
      .from('ai_conversations')
      .select('id, project_id, model')
      .eq('id', body.conversationId)
      .eq('user_id', user.id)
      .single()
    if (conversationError || !conversation) return json({ error: 'Conversation not found' }, 404)

    const defaultModel =
      process.env.OPENROUTER_DEFAULT_MODEL?.trim() || 'google/gemini-2.5-flash'
    const activeModel = body.model ?? conversation.model ?? defaultModel
    const activeProjectId = body.projectId ?? conversation.project_id

    const [{ data: history }, { data: projects }, { data: tasks }] = await Promise.all([
      userClient
        .from('ai_messages')
        .select('role, content')
        .eq('conversation_id', body.conversationId)
        .order('created_at', { ascending: false })
        .limit(16),
      userClient
        .from('projects')
        .select('id, name, description, completion_pct, health')
        .eq('user_id', user.id)
        .neq('status', 'archived')
        .limit(12),
      userClient
        .from('tasks')
        .select('id, title, status, priority, due_at, project_id')
        .eq('user_id', user.id)
        .neq('status', 'archived')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(20),
    ])

    const scopedTasks = activeProjectId
      ? (tasks ?? []).filter((task) => task.project_id === activeProjectId)
      : (tasks ?? [])
    const agentInstruction =
      agentPrompts[body.agentId ?? 'chief_of_staff'] ?? agentPrompts.chief_of_staff
    const locale = body.locale?.startsWith('ar') ? 'ar' : 'en'
    const languageInstruction =
      locale === 'ar'
        ? 'Respond to the user in Arabic (Modern Standard Arabic). Keep action JSON keys/types in English as specified. User-facing titles and summaries inside action fields may be Arabic when appropriate.'
        : 'Respond to the user in English.'
    const systemPrompt = `You are Hilm AI. ${agentInstruction}
${languageInstruction}
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
        'HTTP-Referer': process.env.APP_URL || process.env.VITE_APP_URL || 'https://hillm.netlify.app',
        'X-Title': 'Hilm',
      },
      body: JSON.stringify({
        model: activeModel,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...(history ?? [])
            .reverse()
            .map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: body.message.trim() },
        ],
      }),
    })

    if (!openRouterResponse.ok || !openRouterResponse.body) {
      return json(
        { error: (await openRouterResponse.text()) || 'OpenRouter request failed' },
        502,
      )
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
                const next = chunk.choices?.[0]?.delta?.content
                if (typeof next === 'string') {
                  content += next
                  controller.enqueue(encoder.encode(sse({ type: 'token', token: next })))
                }
              } catch {
                // Ignore malformed provider chunks
              }
            }
            if (done) break
          }

          const actions = actionsFromContent(content)
          await userClient.from('ai_messages').insert([
            {
              user_id: user.id,
              conversation_id: body.conversationId,
              role: 'user',
              content: body.message.trim(),
              actions: [],
            },
            {
              user_id: user.id,
              conversation_id: body.conversationId,
              role: 'assistant',
              content,
              actions,
              model: activeModel,
            },
          ])
          await userClient
            .from('ai_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', body.conversationId)

          if (actions.length) controller.enqueue(encoder.encode(sse({ type: 'actions', actions })))
          controller.enqueue(encoder.encode(sse({ type: 'done', content, actions })))
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              sse({
                type: 'error',
                error: error instanceof Error ? error.message : 'Streaming failed',
              }),
            ),
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'AI request failed' }, 400)
  }
}
