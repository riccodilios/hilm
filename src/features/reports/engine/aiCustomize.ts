import { getReportType, listReportTypes } from '@/features/reports/catalog'
import type {
  DateRangePreset,
  MetricId,
  ReportChartId,
  ReportChartSpec,
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
  { id: 'tasks_created', keys: ['created', 'inbox'] },
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
  { id: 'open_tasks', keys: ['open tasks', 'open work', 'in progress'] },
  { id: 'project_count', keys: ['project count', 'how many projects'] },
]

const CHART_HINTS: Array<{ id: ReportChartId; keys: string[]; preferPie?: boolean }> = [
  { id: 'tasks_by_status', keys: ['by status', 'status chart', 'status breakdown', 'status pie', 'status graph'] },
  {
    id: 'tasks_by_priority',
    keys: ['by priority', 'priority chart', 'priority breakdown', 'priority pie', 'priority graph'],
    preferPie: true,
  },
  {
    id: 'effort_by_project',
    keys: ['by project', 'project chart', 'effort by project', 'project breakdown', 'project graph'],
  },
  {
    id: 'open_by_member',
    keys: ['by member', 'member chart', 'assignee', 'people chart', 'workload chart', 'who has'],
  },
]

const ALL_CHART_IDS: ReportChartId[] = [
  'tasks_by_status',
  'tasks_by_priority',
  'effort_by_project',
  'open_by_member',
]

function defaultChartsForType(typeId: ReportTypeId, os: ReportOs): ReportChartSpec[] {
  const charts: ReportChartSpec[] = [
    { id: 'tasks_by_status', kind: 'bar' },
    { id: 'tasks_by_priority', kind: 'pie' },
  ]
  if (
    typeId.includes('project') ||
    typeId === 'workload' ||
    typeId === 'time_allocation' ||
    typeId === 'workspace_overview' ||
    typeId === 'custom'
  ) {
    charts.push({ id: 'effort_by_project', kind: 'bar' })
  }
  if (os === 'workspace' || typeId.includes('team') || typeId.includes('workload')) {
    charts.push({ id: 'open_by_member', kind: 'bar' })
  }
  return charts
}

function preferPieFromPrompt(text: string) {
  return /\b(pie|donut|doughnut|circle chart)\b/i.test(text)
}

function preferBarFromPrompt(text: string) {
  return /\b(bar|column|histogram)\b/i.test(text)
}

/**
 * Interpret a natural-language request into report configuration.
 * Selects catalog types/metrics/charts — does not invent fake numbers.
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

  const chartMap = new Map<ReportChartId, ReportChartSpec>()
  for (const chart of base?.charts?.length ? base.charts : defaultChartsForType(typeId, os)) {
    chartMap.set(chart.id, chart)
  }

  const wantsCharts =
    /\b(chart|charts|graph|graphs|pie|bar|visual|visualization|breakdown|distribution)\b/i.test(
      text,
    )
  if (wantsCharts) {
    // Ensure charts section data is present when user asks for visuals.
    for (const id of ALL_CHART_IDS) {
      if (!chartMap.has(id) && CHART_HINTS.some((hint) => hint.id === id && hint.keys.some((k) => text.includes(k)))) {
        chartMap.set(id, {
          id,
          kind: preferPieFromPrompt(text) ? 'pie' : 'bar',
        })
      }
    }
    if (chartMap.size === 0 || CHART_HINTS.every((hint) => !hint.keys.some((k) => text.includes(k)))) {
      // Broad "add charts/graphs" → include the full visual set
      for (const id of ALL_CHART_IDS) {
        if (!chartMap.has(id)) {
          chartMap.set(id, {
            id,
            kind: id === 'tasks_by_priority' || preferPieFromPrompt(text) ? 'pie' : 'bar',
          })
        }
      }
    }
  }

  for (const hint of CHART_HINTS) {
    if (!hint.keys.some((key) => text.includes(key))) continue
    const kind = preferPieFromPrompt(text) && !preferBarFromPrompt(text)
      ? 'pie'
      : preferBarFromPrompt(text) && !preferPieFromPrompt(text)
        ? 'bar'
        : hint.preferPie
          ? 'pie'
          : chartMap.get(hint.id)?.kind ?? 'bar'
    chartMap.set(hint.id, { id: hint.id, kind })
  }

  // If the user only asked for pie OR only for bar (not both), apply that kind to charts
  // that were added from a broad "charts/graphs" request without a specific kind.
  if (preferPieFromPrompt(text) !== preferBarFromPrompt(text)) {
    const kind = preferPieFromPrompt(text) ? 'pie' : 'bar'
    const specific = new Set(
      CHART_HINTS.filter((hint) => hint.keys.some((key) => text.includes(key))).map((hint) => hint.id),
    )
    for (const [id, chart] of chartMap) {
      if (specific.has(id)) continue
      chartMap.set(id, { ...chart, kind })
    }
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
  if (chartMap.size) {
    notes.push(
      `Charts included: ${[...chartMap.values()]
        .map((chart) => `${chart.id.replaceAll('_', ' ')} (${chart.kind})`)
        .join(', ')}.`,
    )
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
      charts: [...chartMap.values()],
      aiPrompt: prompt.trim(),
      locale: base?.locale,
    },
    notes,
  }
}
