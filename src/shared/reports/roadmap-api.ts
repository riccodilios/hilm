import { supabase } from '@/lib/supabase/client'
import { getAppUrl, getSupabaseAnonKey } from '@/lib/env'
import type { ReportOs } from '@/shared/reports/types'
import type { RoadmapReportData } from '@/shared/reports/roadmap'

function endpoint() {
  const local = (url: string) => /localhost|127\.0\.0\.1/i.test(url)
  if (typeof window !== 'undefined' && !local(window.location.origin)) return `${window.location.origin}/api/ai-roadmap-report`
  const app = getAppUrl()
  return `${(app || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')}/api/ai-roadmap-report`
}

export async function fetchRoadmapReport(input: {
  os: ReportOs
  workspaceId?: string | null
  projectIds: string[] | 'all'
  locale: 'en' | 'ar'
  periodStart: string
  periodEnd: string
  includeAi: boolean
}): Promise<RoadmapReportData> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: getSupabaseAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      os: input.os,
      workspaceId: input.workspaceId ?? undefined,
      projectIds: input.projectIds === 'all' ? null : input.projectIds,
      locale: input.locale,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      includeAi: input.includeAi,
      idempotencyKey: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined,
    }),
  })
  const payload = (await response.json().catch(() => ({}))) as Partial<RoadmapReportData> & { error?: string }
  if (!response.ok || !Array.isArray(payload.projects)) {
    throw new Error(payload.error || 'Could not load the roadmap report')
  }
  return { projects: payload.projects, analysis: payload.analysis ?? null, aiError: payload.aiError ?? null }
}
