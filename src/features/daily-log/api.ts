import { supabase } from '@/lib/supabase/client'
import { getAppUrl, getSupabaseAnonKey } from '@/lib/env'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables } from '@/types/database'
import { todayISO } from '@/lib/utils'

export const dailyLogKeys = {
  all: ['daily-logs'] as const,
  byDate: (date: string) => [...dailyLogKeys.all, date] as const,
  stats: (date: string) => [...dailyLogKeys.all, 'stats', date] as const,
}

export type DailyLogStats = {
  completed: number
  created: number
  openDue: number
  activityCount: number
  notesTouched: number
  ideasCaptured: number
  aiMessages: number
  byEntity: {
    task: number
    note: number
    project: number
    ai: number
    idea: number
    other: number
  }
}

export type GeneratedDailyLogResult = {
  log: Tables<'daily_logs'>
  stats: DailyLogStats
}

function getDailyLogUrl() {
  if (typeof window !== 'undefined') {
    const origin = window.location.origin.replace(/\/$/, '')
    if (!/localhost|127\.0\.0\.1/i.test(origin)) {
      return `${origin}/api/ai-daily-log`
    }
  }
  const app = getAppUrl()
  if (app && !/localhost|127\.0\.0\.1/i.test(app)) {
    return `${app.replace(/\/$/, '')}/api/ai-daily-log`
  }
  // Local Vite: hit production Netlify function if APP_URL is set, else same-origin (needs proxy).
  return `${(app || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')}/api/ai-daily-log`
}

export function dayBoundsISO(logDate: string) {
  const start = new Date(`${logDate}T00:00:00`)
  const end = new Date(`${logDate}T23:59:59.999`)
  return {
    dayStart: start.toISOString(),
    dayEnd: end.toISOString(),
  }
}

function bucketEntity(entityType: string | null | undefined): keyof DailyLogStats['byEntity'] {
  const type = (entityType ?? '').toLowerCase()
  if (type.includes('task')) return 'task'
  if (type.includes('note')) return 'note'
  if (type.includes('project')) return 'project'
  if (type.includes('ai') || type.includes('conversation') || type.includes('message')) return 'ai'
  if (type.includes('idea')) return 'idea'
  return 'other'
}

export async function getDailyLog(logDate = todayISO()) {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('log_date', logDate)
    .maybeSingle()
  if (error) throw error
  return data as Tables<'daily_logs'> | null
}

export async function getDailyLogStats(logDate = todayISO()): Promise<DailyLogStats> {
  const { dayStart, dayEnd } = dayBoundsISO(logDate)
  const [
    { count: completed, error: completedError },
    { count: created, error: createdError },
    { count: openDue, error: openDueError },
    { data: activity, error: activityError },
    { count: notesTouched, error: notesError },
    { count: ideasCaptured, error: ideasError },
    { count: aiMessages, error: aiError },
  ] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .gte('completed_at', dayStart)
      .lte('completed_at', dayEnd),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'done')
      .neq('status', 'archived')
      .gte('due_at', dayStart)
      .lte('due_at', dayEnd),
    supabase
      .from('activity_events')
      .select('entity_type')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
      .limit(100),
    supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .gte('updated_at', dayStart)
      .lte('updated_at', dayEnd),
    supabase
      .from('ideas')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd),
    supabase
      .from('ai_messages')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd),
  ])

  if (completedError) throw completedError
  if (createdError) throw createdError
  if (openDueError) throw openDueError
  if (activityError) throw activityError
  if (notesError) throw notesError
  if (ideasError) throw ideasError
  if (aiError) throw aiError

  const byEntity: DailyLogStats['byEntity'] = {
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
  if (aiMessages) byEntity.ai += aiMessages

  return {
    completed: completed ?? 0,
    created: created ?? 0,
    openDue: openDue ?? 0,
    activityCount: activity?.length ?? 0,
    notesTouched: notesTouched ?? 0,
    ideasCaptured: ideasCaptured ?? 0,
    aiMessages: aiMessages ?? 0,
    byEntity,
  }
}

export async function upsertDailyLog(input: {
  logDate?: string
  workedOn?: string
  blockers?: string
  hours?: number | null
  wins?: string
  tomorrow?: string
  aiSummary?: string
}) {
  const userId = await requireUserId()
  const logDate = input.logDate ?? todayISO()
  const payload: Inserts<'daily_logs'> = {
    user_id: userId,
    log_date: logDate,
    worked_on: input.workedOn,
    blockers: input.blockers,
    hours: input.hours ?? null,
    wins: input.wins,
    tomorrow: input.tomorrow,
    ai_summary: input.aiSummary,
  }
  const { data, error } = await supabase
    .from('daily_logs')
    .upsert(payload, { onConflict: 'user_id,log_date' })
    .select('*')
    .single()
  if (error) throw error
  await recordActivity({
    userId,
    entityType: 'daily_log',
    entityId: data.id,
    action: 'upserted',
    summary: `Updated daily log for ${logDate}`,
  })
  return data as Tables<'daily_logs'>
}

export async function generateDailyLog(input: {
  logDate?: string
  locale?: string
}): Promise<GeneratedDailyLogResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const logDate = input.logDate ?? todayISO()
  const { dayStart, dayEnd } = dayBoundsISO(logDate)
  const response = await fetch(getDailyLogUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: getSupabaseAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      logDate,
      dayStart,
      dayEnd,
      locale: input.locale,
    }),
  })

  const payload = (await response.json()) as {
    log?: Tables<'daily_logs'>
    stats?: DailyLogStats
    error?: string
  }
  if (!response.ok || !payload.log || !payload.stats) {
    throw new Error(payload.error || 'Could not generate daily log')
  }
  return { log: payload.log, stats: payload.stats }
}
