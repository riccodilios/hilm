import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  aiLimitStatus,
  beginAiRequest,
  completeAiRequest,
  estimateTokensFromText,
  friendlyAiLimitPayload,
  tokensFromOpenRouterUsage,
} from '../_shared/ai-guard.ts'
import {
  personalActionCatalog,
  personalActionInstruction,
  workspaceActionCatalog,
  workspaceActionInstruction,
} from '../_shared/ai-action-catalog.ts'
import {
  annotateTasksForAi,
  buildAiTimeContextPrompt,
  resolveAiClock,
} from '../_shared/ai-time-context.ts'
import { assertAiMessageLength, resolveAllowedAiModel } from '../_shared/ai-limits.ts'
import { actionsFromContent } from '../_shared/actions-parse.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, idempotency-key, x-idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const agentPrompts: Record<string, string> = {
  chief_of_staff: `You are Hilm's Chief of Staff. Prioritize outcomes and identify the most valuable next steps. Be concise and decisive.`,
  project_manager: `You are Hilm's Project Manager. Assess scope, milestones, risks, and delivery progress.`,
  task_manager: `You are Hilm's Task Manager. Turn work into small, concrete, properly sequenced tasks.`,
  documentation_writer: `You are Hilm's Documentation Writer. Write clear, audience-appropriate documentation.`,
  planning_assistant: `You are Hilm's Planning Assistant. Create realistic plans with dependencies and milestones.`,
  architecture_advisor: `You are Hilm's Architecture Advisor. Explain technical trade-offs, constraints, and design options.`,
  meeting_summarizer: `You are Hilm's Meeting Summarizer. Summarize decisions, open questions, and follow-up items.`,
  qa_assistant: `You are Hilm's QA Assistant. Create focused test plans, edge cases, and release-risk assessments.`,
}

function sse(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  let usageEventId: string | null = null
  // deno-lint-ignore no-explicit-any
  let admin: any = null
  let activeModel = Deno.env.get('OPENROUTER_DEFAULT_MODEL') ?? 'google/gemini-2.5-flash'
  let userId: string | null = null

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) throw new Error('Missing authorization token')
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) throw new Error('Unauthorized')
    userId = user.id

    const body = await request.json() as {
      conversationId?: string
      message?: string
      agentId?: string
      projectId?: string
      workspaceId?: string
      model?: string
      locale?: string
      timezone?: string
      clientNow?: string
      clientLocalDate?: string
      idempotencyKey?: string
      fingerprint?: string
      conversationFocus?: {
        lastCreatedTaskId?: string | null
        lastModifiedTaskId?: string | null
        lastReferencedProjectId?: string | null
        lastReferencedWorkspaceId?: string | null
        lastTaskTitle?: string | null
      }
    }
    if (!body.conversationId || !body.message?.trim()) throw new Error('conversationId and message are required')
    const messageTooLong = assertAiMessageLength(body.message.trim())
    if (messageTooLong) throw new Error(messageTooLong)

    admin = createClient(url, serviceKey)
    const { data: conversation, error: conversationError } = await admin
      .from('ai_conversations')
      .select('id, project_id, model, workspace_id')
      .eq('id', body.conversationId)
      .eq('user_id', user.id)
      .single()
    if (conversationError || !conversation) throw new Error('Conversation not found')

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured on the server')
    }

    const defaultModel =
      Deno.env.get('OPENROUTER_DEFAULT_MODEL') ?? 'google/gemini-2.5-flash'
    activeModel = resolveAllowedAiModel({
      requested: body.model,
      conversationModel: conversation.model,
      defaultModel,
      allowedEnv: Deno.env.get('OPENROUTER_ALLOWED_MODELS'),
    })
    const activeWorkspaceId = body.workspaceId ?? conversation.workspace_id ?? null
    const activeProjectId = body.projectId ?? conversation.project_id

    const idempotencyKey =
      body.idempotencyKey?.trim() ||
      request.headers.get('Idempotency-Key')?.trim() ||
      request.headers.get('x-idempotency-key')?.trim() ||
      null
    const fingerprint =
      body.fingerprint?.trim() ||
      `chat:${body.conversationId}:${body.message.trim().slice(0, 500)}`

    if (activeWorkspaceId) {
      const { data: membership } = await admin
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', activeWorkspaceId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!membership) throw new Error('Not a member of this workspace')
      if (conversation.workspace_id && conversation.workspace_id !== activeWorkspaceId) {
        throw new Error('Conversation does not belong to this workspace')
      }
    } else if (conversation.workspace_id) {
      throw new Error('Workspace conversation requires workspaceId')
    }

    const guard = await beginAiRequest(admin, {
      requestKind: 'chat',
      model: activeModel,
      workspaceId: activeWorkspaceId,
      conversationId: body.conversationId,
      idempotencyKey,
      fingerprint,
      userId: user.id,
    })
    if (!guard.ok) {
      return Response.json(friendlyAiLimitPayload(guard), {
        status: aiLimitStatus(guard.code),
        headers: corsHeaders,
      })
    }
    usageEventId = guard.event_id ?? null

    const { data: history } = await admin
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', body.conversationId)
      .order('created_at', { ascending: false })
      .limit(16)

    const clock = resolveAiClock({
      timezone: body.timezone,
      clientNow: body.clientNow,
      clientLocalDate: body.clientLocalDate,
      locale: body.locale,
    })
    const timeContext = buildAiTimeContextPrompt(clock)

    let contextPack = ''
    let actionCatalog = ''
    let modeLabel = 'Personal OS'

    if (activeWorkspaceId) {
      modeLabel = 'Workspace OS'
      const [
        { data: projects },
        { data: tasks },
        { data: members },
        { data: activity },
        { data: workspace },
      ] = await Promise.all([
        admin.from('workspace_projects').select('id, name, description, completion_pct, health, status').eq('workspace_id', activeWorkspaceId).neq('status', 'archived').limit(20),
        admin.from('workspace_tasks').select('id, title, status, priority, due_date, due_at, project_id, assignee_id, task_number').eq('workspace_id', activeWorkspaceId).neq('status', 'archived').order('due_date', { ascending: true, nullsFirst: false }).limit(40),
        admin.from('workspace_members').select('user_id, role').eq('workspace_id', activeWorkspaceId),
        admin.from('workspace_activity_events').select('event_type, summary, created_at, entity_type').eq('workspace_id', activeWorkspaceId).order('created_at', { ascending: false }).limit(15),
        admin.from('workspaces').select('id, name, description, task_key').eq('id', activeWorkspaceId).maybeSingle(),
      ])
      const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id)
      const { data: profiles } = memberIds.length
        ? await admin.from('profiles').select('id, display_name').in('id', memberIds)
        : { data: [] as { id: string; display_name: string | null }[] }
      const profileMap = new Map((profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name]))
      const memberContext = (members ?? []).map((m: { user_id: string; role: string }) => ({
        id: m.user_id,
        role: m.role,
        name: (profileMap.get(m.user_id) || '').trim() || 'Unnamed User',
      }))
      const taskKey = (workspace as { task_key?: string } | null)?.task_key ?? 'TASK'
      const scopedTasks = annotateTasksForAi(
        activeProjectId
          ? (tasks ?? []).filter((task: { project_id: string }) => task.project_id === activeProjectId)
          : (tasks ?? []),
        clock,
      ).map((task: Record<string, unknown>) => {
        const number = task.task_number
        return {
          ...task,
          ref: typeof number === 'number' ? `${taskKey}-${number}` : undefined,
        }
      })
      actionCatalog = workspaceActionCatalog
      const { data: wsLabels } = await admin
        .from('workspace_labels')
        .select('id, name, color')
        .eq('workspace_id', activeWorkspaceId)
        .order('name')
        .limit(40)
      contextPack = `You are operating strictly inside Workspace OS for workspace "${workspace?.name ?? activeWorkspaceId}" (task_key=${taskKey}). Never access or invent Personal OS data.
When referencing an existing task, set taskId to the task's id UUID OR its ref (e.g. ${taskKey}-12) OR the exact title from Tasks. Never invent UUIDs.
Workspace: ${JSON.stringify(workspace ?? { id: activeWorkspaceId, task_key: taskKey })}
Members: ${JSON.stringify(memberContext)}
Projects: ${JSON.stringify(projects ?? [])}
Tasks: ${JSON.stringify(scopedTasks)}
Labels: ${JSON.stringify(wsLabels ?? [])}
Recent activity: ${JSON.stringify(activity ?? [])}`
    } else {
      const [{ data: projects }, { data: tasks }, { data: labels }] = await Promise.all([
        admin.from('projects').select('id, name, description, completion_pct, health').eq('user_id', user.id).neq('status', 'archived').limit(12),
        admin.from('tasks').select('id, title, status, priority, due_at, project_id').eq('user_id', user.id).neq('status', 'archived').order('due_at', { ascending: true, nullsFirst: false }).limit(20),
        admin.from('tags').select('id, name, color').eq('user_id', user.id).order('name').limit(40),
      ])
      const scopedTasks = annotateTasksForAi(
        activeProjectId ? (tasks ?? []).filter((task: { project_id: string }) => task.project_id === activeProjectId) : tasks ?? [],
        clock,
      )
      actionCatalog = personalActionCatalog
      contextPack = `You are operating strictly inside Personal OS. Never access workspace/team data.
Projects: ${JSON.stringify(projects ?? [])}
Tasks: ${JSON.stringify(scopedTasks)}
Labels: ${JSON.stringify(labels ?? [])}`
    }

    const baseAgent = agentPrompts[body.agentId ?? 'chief_of_staff'] ?? agentPrompts.chief_of_staff
    const agentInstruction = `${baseAgent} ${activeWorkspaceId ? workspaceActionInstruction : personalActionInstruction}`
    const locale = body.locale?.startsWith('ar') ? 'ar' : 'en'
    const languageInstruction =
      locale === 'ar'
        ? 'Respond to the user in Arabic (Modern Standard Arabic). Keep action JSON keys/types in English as specified. User-facing titles and summaries inside action fields may be Arabic when appropriate.'
        : 'Respond to the user in English.'
    const focus = body.conversationFocus
    const focusLines: string[] = []
    if (focus?.lastCreatedTaskId) focusLines.push(`lastCreatedTaskId=${focus.lastCreatedTaskId}`)
    if (focus?.lastModifiedTaskId) focusLines.push(`lastModifiedTaskId=${focus.lastModifiedTaskId}`)
    if (focus?.lastTaskTitle) focusLines.push(`lastTaskTitle=${JSON.stringify(focus.lastTaskTitle)}`)
    if (focus?.lastReferencedProjectId) {
      focusLines.push(`lastReferencedProjectId=${focus.lastReferencedProjectId}`)
    }
    if (focus?.lastReferencedWorkspaceId) {
      focusLines.push(`lastReferencedWorkspaceId=${focus.lastReferencedWorkspaceId}`)
    }
    const focusBlock = focusLines.length
      ? `Conversation focus (prefer these IDs for follow-ups — UPDATE existing entities, do not recreate):\n${focusLines.join('\n')}`
      : ''

    const systemPrompt = `You are Hilm AI (${modeLabel}). ${agentInstruction}
${languageInstruction}
${timeContext}
${focusBlock}
Respond in helpful, concise Markdown. When you propose executable changes, append exactly one fenced \`\`\`actions JSON block at the end.

Create example (1–3 NEW tasks):
\`\`\`actions
[{"type":"task.create","title":"Prepare Wasl documentation","projectName":"Wasl","priority":"medium"}]
\`\`\`

${activeWorkspaceId ? `Batch create example (4+ NEW tasks — REQUIRED shape for large requests):
\`\`\`actions
[{"type":"task.create_many","projectName":"Finance","items":[{"title":"Reconcile invoices"},{"title":"Update forecast"},{"title":"Send vendor reminders"}]}]
\`\`\`
` : ''}Update example (when refining an existing / focused task — preferred for follow-ups):
\`\`\`actions
[{"type":"task.update","taskId":"<existing-task-uuid>","title":"Wasl docs","description":"Add more detail here"}]
\`\`\`

Schedule example (always update the existing task — never create untitled tasks):
\`\`\`actions
[{"type":"task.schedule","taskId":"<existing-task-uuid>","dueAt":"2026-08-11T10:30:00"}]
\`\`\`

${actionCatalog} Only use IDs in the provided context or Conversation focus. Do not include an actions block when no action is useful.
Context pack:
${contextPack}`
    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': Deno.env.get('SITE_URL') ?? 'https://hilm.app',
        'X-Title': 'Hilm',
      },
      body: JSON.stringify({
        model: activeModel,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: activeWorkspaceId ? 8192 : 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          ...(history ?? []).reverse().map((message: { role: string; content: string }) => ({ role: message.role, content: message.content })),
          { role: 'user', content: body.message.trim() },
        ],
      }),
    })
    if (!openRouterResponse.ok || !openRouterResponse.body) {
      const detail = (await openRouterResponse.text()) || 'OpenRouter request failed'
      if (usageEventId) {
        await completeAiRequest(admin, {
          eventId: usageEventId,
          status: 'failed',
          errorCode: 'provider_error',
          errorMessage: detail.slice(0, 500),
          model: activeModel,
          userId: user.id,
        })
      }
      throw new Error(detail)
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = openRouterResponse.body!.getReader()
        let buffer = ''
        let content = ''
        let finishReason: string | null = null
        let usage = tokensFromOpenRouterUsage(null)
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
                if (chunk.usage) usage = tokensFromOpenRouterUsage(chunk.usage)
                const choice = chunk.choices?.[0]
                if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason
                const token = choice?.delta?.content
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
          if (!usage.totalTokens) {
            const inputEstimate = estimateTokensFromText(systemPrompt + body.message.trim())
            const outputEstimate = estimateTokensFromText(content)
            usage = {
              inputTokens: inputEstimate,
              outputTokens: outputEstimate,
              totalTokens: inputEstimate + outputEstimate,
            }
          }
          const parsedActions = actionsFromContent(content)
          const actions = parsedActions.actions
          const truncated =
            parsedActions.truncated || finishReason === 'length' || Boolean(parsedActions.parseError)
          await admin.from('ai_messages').insert([
            { user_id: user.id, conversation_id: body.conversationId, role: 'user', content: body.message.trim(), actions: [] },
            { user_id: user.id, conversation_id: body.conversationId, role: 'assistant', content, actions, model: activeModel },
          ])
          await admin.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', body.conversationId)
          if (usageEventId) {
            await completeAiRequest(admin, {
              eventId: usageEventId,
              status: 'completed',
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              model: activeModel,
              userId: user.id,
            })
          }
          if (truncated && !actions.length) {
            controller.enqueue(
              encoder.encode(
                sse({
                  type: 'error',
                  error:
                    'The action plan was truncated before it could be parsed. Ask me to continue the remaining tasks, or retry with task.create_many.',
                  code: 'actions_truncated',
                }),
              ),
            )
          } else {
            if (truncated && actions.length) {
              controller.enqueue(
                encoder.encode(
                  sse({
                    type: 'actions_warning',
                    warning:
                      'Action plan may be incomplete (truncated output). Review the proposed tasks before applying.',
                    recovered: actions.length,
                  }),
                ),
              )
            }
            if (actions.length) controller.enqueue(encoder.encode(sse({ type: 'actions', actions })))
            controller.enqueue(encoder.encode(sse({ type: 'done', content, actions, truncated, finishReason })))
          }
        } catch (error) {
          if (usageEventId) {
            await completeAiRequest(admin, {
              eventId: usageEventId,
              status: 'failed',
              errorCode: 'stream_error',
              errorMessage: error instanceof Error ? error.message : 'Streaming failed',
              model: activeModel,
              userId: user.id,
            })
          }
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
    if (usageEventId && admin && userId) {
      await completeAiRequest(admin, {
        eventId: usageEventId,
        status: 'failed',
        errorCode: 'handler_error',
        errorMessage: error instanceof Error ? error.message : 'AI request failed',
        model: activeModel,
        userId,
      })
    }
    return Response.json(
      { error: error instanceof Error ? error.message : 'AI request failed' },
      { status: 400, headers: corsHeaders },
    )
  }
})
