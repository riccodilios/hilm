import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

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

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] ?? text).trim()
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
      } catch {
        return null
      }
    }
  }
  return null
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asHours(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value * 4) / 4)
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.max(0, Math.round(n * 4) / 4)
  }
  return null
}

type EntityBucket = 'task' | 'note' | 'project' | 'ai' | 'idea' | 'other'

function bucketEntity(entityType: string | null | undefined): EntityBucket {
  const type = (entityType ?? '').toLowerCase()
  if (type.includes('task')) return 'task'
  if (type.includes('note')) return 'note'
  if (type.includes('project')) return 'project'
  if (type.includes('ai') || type.includes('conversation') || type.includes('message')) return 'ai'
  if (type.includes('idea')) return 'idea'
  return 'other'
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
      logDate?: string
      dayStart?: string
      dayEnd?: string
      locale?: string
    }

    const logDate = body.logDate?.trim()
    const dayStart = body.dayStart?.trim()
    const dayEnd = body.dayEnd?.trim()
    if (!logDate || !dayStart || !dayEnd) {
      return json({ error: 'logDate, dayStart, and dayEnd are required' }, 400)
    }

    const [
      { data: completedTasks },
      { data: createdTasks },
      { data: openDueTasks },
      { data: activity },
      { data: notes },
      { data: ideas },
      { data: aiMessages },
      { data: projects },
      { data: existingLog },
    ] = await Promise.all([
      userClient
        .from('tasks')
        .select('id, title, project_id, priority, status, completed_at')
        .eq('user_id', user.id)
        .gte('completed_at', dayStart)
        .lte('completed_at', dayEnd)
        .order('completed_at', { ascending: false })
        .limit(40),
      userClient
        .from('tasks')
        .select('id, title, project_id, priority, status, created_at')
        .eq('user_id', user.id)
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at', { ascending: false })
        .limit(40),
      userClient
        .from('tasks')
        .select('id, title, project_id, priority, status, due_at')
        .eq('user_id', user.id)
        .neq('status', 'done')
        .neq('status', 'archived')
        .gte('due_at', dayStart)
        .lte('due_at', dayEnd)
        .limit(40),
      userClient
        .from('activity_events')
        .select('entity_type, action, summary, project_id, created_at')
        .eq('user_id', user.id)
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at', { ascending: false })
        .limit(60),
      userClient
        .from('notes')
        .select('id, title, updated_at')
        .eq('user_id', user.id)
        .gte('updated_at', dayStart)
        .lte('updated_at', dayEnd)
        .order('updated_at', { ascending: false })
        .limit(20),
      userClient
        .from('ideas')
        .select('id, title, created_at')
        .eq('user_id', user.id)
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at', { ascending: false })
        .limit(20),
      userClient
        .from('ai_messages')
        .select('role, content, created_at')
        .eq('user_id', user.id)
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .order('created_at', { ascending: false })
        .limit(24),
      userClient
        .from('projects')
        .select('id, name, health, completion_pct')
        .eq('user_id', user.id)
        .neq('status', 'archived')
        .limit(20),
      userClient.from('daily_logs').select('*').eq('user_id', user.id).eq('log_date', logDate).maybeSingle(),
    ])

    const byEntity: Record<EntityBucket, number> = {
      task: 0,
      note: 0,
      project: 0,
      ai: 0,
      idea: 0,
      other: 0,
    }
    for (const event of activity ?? []) {
      byEntity[bucketEntity(event.entity_type)] += 1
    }
    if ((aiMessages ?? []).length) byEntity.ai += aiMessages!.length

    const stats = {
      completed: completedTasks?.length ?? 0,
      created: createdTasks?.length ?? 0,
      openDue: openDueTasks?.length ?? 0,
      activityCount: activity?.length ?? 0,
      notesTouched: notes?.length ?? 0,
      ideasCaptured: ideas?.length ?? 0,
      aiMessages: aiMessages?.length ?? 0,
      byEntity,
    }

    const contextPack = {
      logDate,
      stats,
      completedTasks: (completedTasks ?? []).map((task) => ({
        title: task.title,
        priority: task.priority,
      })),
      createdTasks: (createdTasks ?? []).map((task) => ({
        title: task.title,
        status: task.status,
      })),
      openDueTasks: (openDueTasks ?? []).map((task) => ({
        title: task.title,
        priority: task.priority,
      })),
      activity: (activity ?? []).slice(0, 40).map((event) => ({
        type: event.entity_type,
        action: event.action,
        summary: event.summary,
      })),
      notes: (notes ?? []).map((note) => note.title),
      ideas: (ideas ?? []).map((idea) => idea.title),
      aiSnippets: (aiMessages ?? [])
        .slice(0, 12)
        .map((message) => ({
          role: message.role,
          content: String(message.content ?? '').slice(0, 280),
        })),
      projects: (projects ?? []).map((project) => ({
        name: project.name,
        health: project.health,
        completionPct: project.completion_pct,
      })),
    }

    const locale = body.locale?.startsWith('ar') ? 'ar' : 'en'
    const languageInstruction =
      locale === 'ar'
        ? 'Write all narrative fields in Arabic (Modern Standard Arabic). Keep JSON keys in English.'
        : 'Write all narrative fields in English.'

    const systemPrompt = `You are Hilm, an AI personal OS. Build today's daily log ONLY from the provided platform activity.
${languageInstruction}
Rules:
- Be concise, concrete, and honest. Do not invent work that is not in the context.
- If activity is sparse, say so briefly and focus on what little happened and a sensible next step.
- Prefer outcomes over busywork.
- hours should be a rough estimate from activity density, or null if unclear.
Return ONLY valid JSON with this shape:
{
  "aiSummary": "2-4 sentence narrative of the day",
  "workedOn": "short paragraph or bullet-like lines of what moved",
  "wins": "wins / completions",
  "blockers": "blockers or open due pressure; empty string if none",
  "tomorrow": "1-3 concrete next moves",
  "hours": number or null
}`

    const model = process.env.OPENROUTER_DEFAULT_MODEL?.trim() || 'google/gemini-2.5-flash'
    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || process.env.VITE_APP_URL || 'https://hillm.netlify.app',
        'X-Title': 'Hilm Daily Log',
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Build the daily log for ${logDate}. Context:\n${JSON.stringify(contextPack)}`,
          },
        ],
      }),
    })

    if (!openRouterResponse.ok) {
      return json(
        { error: (await openRouterResponse.text()) || 'OpenRouter request failed' },
        502,
      )
    }

    const payload = (await openRouterResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = payload.choices?.[0]?.message?.content ?? ''
    const parsed = extractJsonObject(content)
    if (!parsed) return json({ error: 'AI returned an unreadable daily log' }, 502)

    const logFields = {
      worked_on: asText(parsed.workedOn) || asText(parsed.worked_on) || null,
      wins: asText(parsed.wins) || null,
      blockers: asText(parsed.blockers) || null,
      tomorrow: asText(parsed.tomorrow) || null,
      hours: asHours(parsed.hours),
      ai_summary: asText(parsed.aiSummary) || asText(parsed.ai_summary) || null,
    }

    if (!logFields.ai_summary && !logFields.worked_on) {
      return json({ error: 'AI returned an empty daily log' }, 502)
    }

    const upsertPayload = {
      user_id: user.id,
      log_date: logDate,
      worked_on: logFields.worked_on,
      wins: logFields.wins,
      blockers: logFields.blockers,
      tomorrow: logFields.tomorrow,
      hours: logFields.hours,
      ai_summary: logFields.ai_summary,
    }

    const { data: saved, error: saveError } = await userClient
      .from('daily_logs')
      .upsert(upsertPayload, { onConflict: 'user_id,log_date' })
      .select('*')
      .single()
    if (saveError) return json({ error: saveError.message }, 400)

    await userClient.from('activity_events').insert({
      user_id: user.id,
      entity_type: 'daily_log',
      entity_id: saved.id,
      action: 'generated',
      summary: `Hilm generated daily log for ${logDate}`,
    })

    return json({
      log: saved,
      stats,
      previous: existingLog ?? null,
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Daily log generation failed' }, 400)
  }
}
