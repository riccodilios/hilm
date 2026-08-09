import { getReportType, listReportTypes } from '@/features/reports/catalog'
import type {
  DateRangePreset,
  MetricId,
  ReportConfig,
  ReportOs,
  ReportTypeId,
} from '@/features/reports/types'

const PRESET_HINTS: Array<{ preset: DateRangePreset; keys: string[] }> = [
  { preset: 'today', keys: ['today'] },
  { preset: 'yesterday', keys: ['yesterday'] },
  { preset: 'this_week', keys: ['this week', 'weekly', 'week'] },
  { preset: 'last_week', keys: ['last week'] },
  { preset: 'this_month', keys: ['this month', 'monthly', 'month'] },
  { preset: 'last_month', keys: ['last month'] },
]

const TYPE_HINTS: Array<{ id: ReportTypeId; keys: string[] }> = [
  { id: 'overdue_tasks', keys: ['overdue', 'behind', 'late'] },
  { id: 'completed_work', keys: ['completed', 'done', 'shipped', 'delivered'] },
  { id: 'team_performance', keys: ['team performance', 'engineering team', 'team'] },
  { id: 'team_workload', keys: ['team workload', 'capacity'] },
  { id: 'department_performance', keys: ['department'] },
  { id: 'project_health', keys: ['health', 'bottleneck', 'blocker', 'risk'] },
  { id: 'project_progress', keys: ['progress', 'roadmap'] },
  { id: 'workload', keys: ['workload', 'load', 'where i spent', 'time spent'] },
  { id: 'time_allocation', keys: ['time allocation', 'allocation'] },
  { id: 'sprint', keys: ['sprint'] },
  { id: 'workspace_overview', keys: ['executive', 'overview', 'organization'] },
  { id: 'weekly_productivity', keys: ['weekly productivity'] },
  { id: 'monthly_productivity', keys: ['monthly productivity'] },
  { id: 'productivity', keys: ['productivity', 'prioritize'] },
  { id: 'ai_activity', keys: ['ai activity', 'ai insights'] },
  { id: 'custom', keys: ['custom'] },
]

const METRIC_HINTS: Array<{ id: MetricId; keys: string[] }> = [
  { id: 'tasks_completed', keys: ['completed', 'done', 'shipped'] },
  { id: 'tasks_created', keys: ['created', 'intake'] },
  { id: 'overdue_tasks', keys: ['overdue', 'behind', 'late'] },
  { id: 'completion_rate', keys: ['completion rate', 'throughput'] },
  { id: 'time_allocation', keys: ['time', 'spent', 'allocation'] },
  { id: 'member_workload', keys: ['member', 'assignee', 'people'] },
  { id: 'team_capacity', keys: ['capacity'] },
  { id: 'project_progress', keys: ['progress'] },
  { id: 'project_health', keys: ['health', 'bottleneck'] },
  { id: 'upcoming_deadlines', keys: ['deadline', 'upcoming', 'next week', 'prioritize'] },
  { id: 'workload', keys: ['workload'] },
  { id: 'ai_insights', keys: ['insight', 'recommend', 'bottleneck'] },
  { id: 'productivity_trend', keys: ['trend', 'productivity'] },
]

/**
 * Interpret a natural-language request into report configuration.
 * Does not invent metrics — only selects catalog options.
 */
export function customizeReportFromPrompt(
  os: ReportOs,
  prompt: string,
  base?: Partial<ReportConfig>,
): { config: ReportConfig; notes: string[] } {
  const text = prompt.trim().toLowerCase()
  const available = listReportTypes(os)
  const availableIds = new Set(available.map((item) => item.id))

  let typeId: ReportTypeId =
    (base?.typeId && availableIds.has(base.typeId) ? base.typeId : null) ??
    (os === 'workspace' ? 'workspace_overview' : 'productivity')

  for (const hint of TYPE_HINTS) {
    if (!availableIds.has(hint.id)) continue
    if (hint.keys.some((key) => text.includes(key))) {
      typeId = hint.id
      break
    }
  }

  let datePreset: DateRangePreset = base?.datePreset ?? 'this_week'
  for (const hint of PRESET_HINTS) {
    if (hint.keys.some((key) => text.includes(key))) {
      datePreset = hint.preset
      break
    }
  }

  const def = getReportType(os, typeId)
  const metrics = new Set<MetricId>(base?.metrics?.length ? base.metrics : def.defaultMetrics)
  for (const hint of METRIC_HINTS) {
    if (hint.keys.some((key) => text.includes(key))) metrics.add(hint.id)
  }

  const notes = [
    `Interpreted request as “${def.title}” for ${datePreset.replace(/_/g, ' ')}.`,
    'Numerical values will be computed only from authorized Hilm data after generation.',
  ]
  if (text.includes('bottleneck') || text.includes('behind') || text.includes('overdue')) {
    notes.push('Emphasizing overdue load and delivery risk based on your wording.')
  }
  if (text.includes('prioritize') || text.includes('next week')) {
    notes.push('Including upcoming deadlines to support next-period prioritization.')
    metrics.add('upcoming_deadlines')
  }

  return {
    config: {
      typeId,
      title: base?.title,
      datePreset,
      customStart: base?.customStart,
      customEnd: base?.customEnd,
      projectIds: base?.projectIds ?? 'all',
      departmentIds: base?.departmentIds ?? 'all',
      teamIds: base?.teamIds ?? 'all',
      memberIds: base?.memberIds ?? 'all',
      metrics: [...metrics],
      aiPrompt: prompt.trim(),
      locale: base?.locale,
    },
    notes,
  }
}
