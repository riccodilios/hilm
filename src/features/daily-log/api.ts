import { supabase } from '@/lib/supabase/client'
import { recordActivity, requireUserId } from '@/lib/supabase/activity'
import type { Inserts, Tables } from '@/types/database'
import { todayISO } from '@/lib/utils'

export const dailyLogKeys = {
  all: ['daily-logs'] as const,
  byDate: (date: string) => [...dailyLogKeys.all, date] as const,
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
