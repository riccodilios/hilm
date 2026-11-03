/**
 * Roadmap report data + AI analysis. Rows are read with the caller's own token (RLS decides what
 * they may see). The roadmap data is always returned; the AI analysis is added when AI is enabled
 * and the caller's quota allows it (same guard and ledger as chat).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { featureDisabledMessage } from './_shared/ai-config'
import { loadEffectiveAiConfig } from './_shared/ai-runtime-db'
import {
  aiCorsHeaders,
  aiJson,
  beginAiRequest,
  completeAiRequest,
  estimateTokensFromText,
  friendlyAiLimitPayload,
  loadOpenRouterKey,
  tokensFromOpenRouterUsage,
} from './_shared/ai-guard'
import { resolveAllowedAiModel } from './_shared/ai-limits'
import { instrumented } from './_shared/ops/instrument.ts'
import {
  analysisContext,
  analysisPrompt,
  buildRoadmapProjects,
  completedTitleFromSummary,
  extractJsonObject,
  sanitizeAnalysis,
  type CompletedStepRow,
  type ProjectRow,
  type StepRow,
  type TaskRow,
} from './_shared/roadmap-report.ts'

const MAX_PROJECTS = 6
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

type Body = {
  os?: string
  workspaceId?: string
  projectIds?: unknown
  locale?: string
  periodStart?: string
  periodEnd?: string
  includeAi?: boolean
  idempotencyKey?: string
}

async function loadRows(client: SupabaseClient, input: { workspaceId: string | null; projectIds: string[] | null }) {
  const ws = input.workspaceId
  const projectTable = ws ? 'workspace_projects' : 'projects'
  const stepTable = ws ? 'workspace_roadmap_items' : 'roadmap_items'

  let projectIds = input.projectIds
  if (!projectIds) {
    // "All": the projects that actually have a roadmap, most steps first.
    let q = client.from(stepTable).select('project_id').limit(2000)
    if (ws) q = q.eq('workspace_id', ws)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const counts = new Map<string, number>()
    for (const row of (data ?? []) as Array<{ project_id: string }>) counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1)
    projectIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_PROJECTS).map(([id]) => id)
  }
  if (!projectIds.length) return { projects: [] as ProjectRow[], steps: [] as StepRow[], tasks: [] as TaskRow[], completed: [] as CompletedStepRow[] }

  let projectQuery = client
    .from(projectTable)
    .select('id, name, description, status, health, health_explanation, completion_pct')
    .in('id', projectIds)
  if (ws) projectQuery = projectQuery.eq('workspace_id', ws)
  const stepColumns = 'id, project_id, title, description, horizon, position, starts_at, ends_at, created_at'
  const taskColumns = ws
    ? 'id, project_id, title, status, priority, due_date, due_at, completed_at, created_at, assignee_id'
    : 'id, project_id, title, status, priority, due_date, due_at, completed_at, created_at'

  const [projects, steps, tasks, completed] = await Promise.all([
    projectQuery,
    client.from(stepTable).select(stepColumns).in('project_id', projectIds).limit(600),
    client
      .from(ws ? 'workspace_tasks' : 'tasks')
      .select(taskColumns)
      .in('project_id', projectIds)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(1500),
    ws
      ? client
          .from('workspace_activity_events')
          .select('summary, payload, created_at')
          .eq('workspace_id', ws)
          .eq('event_type', 'roadmap.completed')
          .order('created_at', { ascending: false })
          .limit(300)
      : client
          .from('activity_events')
          .select('summary, project_id, metadata, created_at')
          .eq('entity_type', 'roadmap_item')
          .eq('action', 'completed')
          .in('project_id', projectIds)
          .order('created_at', { ascending: false })
          .limit(300),
  ])
  for (const result of [projects, steps, tasks, completed]) {
    if (result.error) throw new Error(result.error.message)
  }

  const order = new Map(projectIds.map((id, index) => [id, index]))
  const completedRows: CompletedStepRow[] = []
  for (const row of (completed.data ?? []) as Array<Record<string, unknown>>) {
    const meta = ((row.payload ?? row.metadata) ?? {}) as Record<string, unknown>
    const projectId = String(row.project_id ?? meta.projectId ?? '')
    if (!order.has(projectId)) continue
    const title = (typeof meta.title === 'string' && meta.title.trim()) || completedTitleFromSummary(String(row.summary ?? ''))
    if (title) completedRows.push({ project_id: projectId, title, completed_at: String(row.created_at) })
  }

  return {
    projects: ((projects.data ?? []) as ProjectRow[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    steps: (steps.data ?? []) as unknown as StepRow[],
    tasks: (tasks.data ?? []) as unknown as TaskRow[],
    completed: completedRows,
  }
}

async function handler(request: Request) {
  const json = (data: unknown, status = 200) => aiJson(data, status, request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: aiCorsHeaders(request) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let usageEventId: string | null = null
  let userClient: SupabaseClient | null = null
  let activeModel = ''
  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Missing authorization token' }, 401)
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) return json({ error: 'Server is not configured' }, 500)

    userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const body = (await request.json().catch(() => ({}))) as Body
    const workspaceId = body.os === 'workspace' ? String(body.workspaceId ?? '') : null
    if (workspaceId !== null && !UUID.test(workspaceId)) return json({ error: 'workspaceId is required' }, 400)
    const requested = Array.isArray(body.projectIds)
      ? [...new Set(body.projectIds.map(String).filter((id) => UUID.test(id)))].slice(0, MAX_PROJECTS)
      : null
    const today = new Date().toISOString().slice(0, 10)
    const periodStart = DATE.test(body.periodStart ?? '') ? body.periodStart! : today
    const periodEnd = DATE.test(body.periodEnd ?? '') ? body.periodEnd! : today
    const locale = body.locale?.startsWith('ar') ? 'ar' : 'en'

    const rows = await loadRows(userClient, { workspaceId, projectIds: requested?.length ? requested : null })
    const projects = buildRoadmapProjects({ ...rows, periodStart, periodEnd, workspace: Boolean(workspaceId) })
    if (!projects.length) return json({ projects: [], analysis: null, aiError: 'no_projects' })
    if (body.includeAi === false) return json({ projects, analysis: null, aiError: null })
    if (!projects.some((project) => project.steps.length || project.stats.tasksTotal)) {
      return json({ projects, analysis: null, aiError: 'no_data' })
    }

    const runtime = await loadEffectiveAiConfig(userClient)
    if (!runtime.aiEnabled) return json({ projects, analysis: null, aiError: featureDisabledMessage('chat') })
    const apiKey = await loadOpenRouterKey()
    if (!apiKey) return json({ projects, analysis: null, aiError: 'AI is not configured on the server' })

    activeModel = resolveAllowedAiModel({ defaultModel: runtime.models.chat, allowedEnv: process.env.OPENROUTER_ALLOWED_MODELS })
    const guard = await beginAiRequest(userClient, {
      requestKind: 'chat',
      model: activeModel,
      workspaceId,
      idempotencyKey: body.idempotencyKey?.trim() || null,
      fingerprint: `roadmap_report:${projects.map((project) => project.id).sort().join(',')}`,
    })
    if (!guard.ok) {
      const limit = friendlyAiLimitPayload(guard)
      return json({ projects, analysis: null, aiError: limit.error, aiCode: limit.code })
    }
    usageEventId = guard.event_id ?? null

    const system = analysisPrompt(locale)
    const prompt = `Analyze these roadmaps.\n${JSON.stringify(analysisContext(projects, rows.tasks, periodStart, periodEnd))}`
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://hilm.tech',
        'X-Title': 'Hilm Roadmap Report',
      },
      body: JSON.stringify({
        model: activeModel,
        stream: false,
        usage: { include: true },
        temperature: 0.3,
        max_tokens: Number(process.env.AI_MAX_TOKENS_ROADMAP_REPORT) || 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(22_000),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500) || 'provider_error'
      await completeAiRequest(userClient, { eventId: usageEventId!, status: 'failed', errorCode: 'provider_error', errorMessage: detail, model: activeModel })
      usageEventId = null
      return json({ projects, analysis: null, aiError: 'The AI provider did not respond. Try again in a moment.' })
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown }
    const content = payload.choices?.[0]?.message?.content ?? ''
    let usage = tokensFromOpenRouterUsage(payload.usage)
    if (!usage.totalTokens) {
      const inputTokens = estimateTokensFromText(system + prompt)
      const outputTokens = estimateTokensFromText(content)
      usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
    }
    const analysis = sanitizeAnalysis(extractJsonObject(content), projects)
    await completeAiRequest(userClient, {
      eventId: usageEventId!,
      status: analysis ? 'completed' : 'failed',
      ...(analysis ? {} : { errorCode: 'parse_error', errorMessage: 'Unreadable roadmap analysis' }),
      model: activeModel,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
    })
    usageEventId = null
    return json({ projects, analysis, aiError: analysis ? null : 'The AI analysis could not be read. Try again.' })
  } catch (error) {
    if (usageEventId && userClient) {
      await completeAiRequest(userClient, {
        eventId: usageEventId,
        status: 'failed',
        errorCode: 'handler_error',
        errorMessage: error instanceof Error ? error.message : 'Roadmap report failed',
        model: activeModel,
      })
    }
    return json({ error: error instanceof Error ? error.message : 'Roadmap report failed' }, 400)
  }
}

export default instrumented('ai-roadmap-report', handler)
