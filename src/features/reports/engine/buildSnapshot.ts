import { getReportType } from '@/features/reports/catalog'
import { resolveReportPeriod } from '@/features/reports/date-ranges'
import { localizedMetricLabel, localizedPdfCopy } from '@/features/reports/i18n'
import type {
  ChartDatum,
  MetricId,
  ReportChartKind,
  ReportConfig,
  ReportMetric,
  ReportOs,
  ReportSnapshot,
  ReportTable,
} from '@/features/reports/types'
import { taskDueDateKey, todayLocalISO } from '@/lib/dates'
import i18n from '@/i18n'

export type ReportSourceTask = {
  id: string
  title: string
  status: string
  priority: string
  project_id?: string | null
  due_date?: string | null
  due_at?: string | null
  completed_at?: string | null
  created_at?: string | null
  estimated_hours?: number | null
  assignee_id?: string | null
  department_id?: string | null
  team_id?: string | null
}

export type ReportSourceProject = {
  id: string
  name: string
  health?: string | null
  completion_pct?: number | null
  status?: string | null
}

export type ReportSourceMember = {
  id: string
  name: string
}

export type ReportBuildInput = {
  os: ReportOs
  config: ReportConfig
  generatedBy: string
  workspaceName?: string | null
  workspaceId?: string | null
  logoUrl?: string | null
  projects: ReportSourceProject[]
  tasks: ReportSourceTask[]
  members?: ReportSourceMember[]
  aiPromptNotes?: string[]
}

function inPeriod(iso: string | null | undefined, start: string, end: string) {
  if (!iso) return false
  const key = iso.slice(0, 10)
  return key >= start && key <= end
}

function countBy(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** Inclusive calendar-day keys between start/end (YYYY-MM-DD), capped for chart readability. */
function enumerateDayKeys(start: string, end: string, maxPoints = 14): string[] {
  const keys: string[] = []
  const cursor = new Date(`${start}T12:00:00`)
  const last = new Date(`${end}T12:00:00`)
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return keys
  while (cursor <= last && keys.length < 62) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  if (keys.length <= maxPoints) return keys
  // Downsample evenly so long months still fit a line chart.
  const step = Math.ceil(keys.length / maxPoints)
  const sampled = keys.filter((_, index) => index % step === 0)
  if (sampled[sampled.length - 1] !== keys[keys.length - 1]) {
    sampled.push(keys[keys.length - 1]!)
  }
  return sampled
}

function shortDayLabel(iso: string, locale: string) {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(locale.startsWith('ar') ? 'ar' : 'en', {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso.slice(5)
  }
}

function metricLabel(id: MetricId, t: ReturnType<typeof i18n.getFixedT>) {
  return localizedMetricLabel(id, t)
}

export function buildReportSnapshot(input: ReportBuildInput): ReportSnapshot {
  const lng = input.config.locale === 'ar' ? 'ar' : 'en'
  const t = i18n.getFixedT(lng)
  const pdf = localizedPdfCopy(t)
  const def = getReportType(input.os, input.config.typeId)
  const typeTitle = t(`reports.types.${def.id}.title`, { defaultValue: def.title })
  const period = resolveReportPeriod(
    input.config.datePreset,
    input.config.customStart,
    input.config.customEnd,
    new Date(),
    lng,
  )
  const today = todayLocalISO()

  const projectFilter = input.config.projectIds
  const projects =
    projectFilter === 'all'
      ? input.projects
      : input.projects.filter((project) => projectFilter.includes(project.id))
  const projectIds = new Set(projects.map((project) => project.id))

  let tasks = input.tasks.filter((task) => {
    if (task.status === 'archived') return false
    if (task.project_id && projectIds.size && !projectIds.has(task.project_id)) return false
    if (input.config.departmentIds && input.config.departmentIds !== 'all') {
      if (!task.department_id || !input.config.departmentIds.includes(task.department_id)) return false
    }
    if (input.config.teamIds && input.config.teamIds !== 'all') {
      if (!task.team_id || !input.config.teamIds.includes(task.team_id)) return false
    }
    if (input.config.memberIds && input.config.memberIds !== 'all') {
      if (!task.assignee_id || !input.config.memberIds.includes(task.assignee_id)) return false
    }
    return true
  })

  const open = tasks.filter((task) => task.status !== 'done')
  const done = tasks.filter((task) => task.status === 'done')
  const completedInPeriod = done.filter((task) =>
    inPeriod(task.completed_at ?? task.created_at, period.start, period.end),
  )
  const createdInPeriod = tasks.filter((task) => inPeriod(task.created_at, period.start, period.end))
  const overdue = open.filter((task) => {
    const key = taskDueDateKey(task)
    return Boolean(key && key < today)
  })
  const upcoming = open.filter((task) => {
    const key = taskDueDateKey(task)
    return Boolean(key && key >= today && key <= period.end)
  })

  const completionRate =
    tasks.length === 0 ? 0 : Math.round((done.length / tasks.length) * 1000) / 10

  const statusMap = new Map<string, number>()
  const priorityMap = new Map<string, number>()
  const projectLoad = new Map<string, number>()
  for (const task of tasks) {
    countBy(statusMap, task.status)
    countBy(priorityMap, task.priority)
    if (task.project_id) {
      const hours = Number(task.estimated_hours ?? 1)
      projectLoad.set(task.project_id, (projectLoad.get(task.project_id) ?? 0) + hours)
    }
  }

  const memberMap = new Map((input.members ?? []).map((member) => [member.id, member.name]))
  const memberLoad = new Map<string, number>()
  for (const task of open) {
    if (!task.assignee_id) continue
    countBy(memberLoad, task.assignee_id)
  }

  const selectedMetrics = input.config.metrics.length
    ? input.config.metrics
    : def.defaultMetrics

  const metrics: ReportMetric[] = selectedMetrics.map((id) => {
    switch (id) {
      case 'tasks_created':
        return { id, label: metricLabel(id, t), value: createdInPeriod.length }
      case 'tasks_completed':
        return { id, label: metricLabel(id, t), value: completedInPeriod.length }
      case 'completion_rate':
        return { id, label: metricLabel(id, t), value: `${completionRate}%` }
      case 'overdue_tasks':
        return { id, label: metricLabel(id, t), value: overdue.length }
      case 'open_tasks':
        return { id, label: metricLabel(id, t), value: open.length }
      case 'project_count':
        return { id, label: metricLabel(id, t), value: projects.length }
      case 'project_progress': {
        const avg =
          projects.length === 0
            ? 0
            : Math.round(
                projects.reduce((sum, project) => sum + Number(project.completion_pct ?? 0), 0) /
                  projects.length,
              )
        return { id, label: metricLabel(id, t), value: `${avg}%` }
      }
      case 'project_health': {
        const blocked = projects.filter((project) =>
          ['blocked', 'critical', 'stalled', 'warning'].includes(String(project.health ?? '')),
        ).length
        return { id, label: metricLabel(id, t), value: blocked }
      }
      case 'time_allocation':
        return {
          id,
          label: metricLabel(id, t),
          value: Math.round([...projectLoad.values()].reduce((a, b) => a + b, 0)),
          hint: t('reports.hints.timeAllocation'),
        }
      case 'workload':
        return {
          id,
          label: metricLabel(id, t),
          value: open.length,
          hint: t('reports.hints.workload'),
        }
      case 'member_workload':
        return {
          id,
          label: metricLabel(id, t),
          value: memberLoad.size,
          hint: t('reports.hints.memberWorkload'),
        }
      case 'team_capacity':
        return {
          id,
          label: metricLabel(id, t),
          value: Math.max(0, (input.members?.length ?? 0) * 5 - open.length),
          hint: t('reports.hints.teamCapacity'),
        }
      case 'productivity_trend':
        return {
          id,
          label: metricLabel(id, t),
          value: completedInPeriod.length - createdInPeriod.length,
          hint: t('reports.hints.productivityTrend'),
        }
      case 'upcoming_deadlines':
        return { id, label: metricLabel(id, t), value: upcoming.length }
      case 'ai_insights':
        return {
          id,
          label: metricLabel(id, t),
          value:
            input.aiPromptNotes?.length ??
            insightsFromData(overdue.length, completionRate, open.length, t).length,
        }
      default:
        return { id, label: metricLabel(id, t), value: '—' }
    }
  })

  const charts: ReportSnapshot['charts'] = []
  const chartSpecs =
    input.config.charts?.length
      ? input.config.charts
      : ([
          { id: 'tasks_by_status' as const, kind: 'bar' as ReportChartKind },
          { id: 'tasks_by_priority' as const, kind: 'pie' as ReportChartKind },
          { id: 'effort_by_project' as const, kind: 'column' as ReportChartKind },
          { id: 'completion_trend' as const, kind: 'line' as ReportChartKind },
          ...(input.os === 'workspace' || memberLoad.size
            ? [{ id: 'open_by_member' as const, kind: 'bar' as ReportChartKind }]
            : []),
          ...(projects.length > 1
            ? [{ id: 'project_comparison' as const, kind: 'comparison' as ReportChartKind }]
            : []),
        ] as const)

  for (const spec of chartSpecs) {
    if (spec.id === 'tasks_by_status' && statusMap.size) {
      charts.push({
        title: t('reports.pdf.tasksByStatus', { defaultValue: 'Tasks by status' }),
        kind: spec.kind,
        data: [...statusMap.entries()].map(([label, value], index) => ({
          label: t(`status.${label}`, { defaultValue: label.replaceAll('_', ' ') }),
          value,
          color: PIE_COLORS[index % PIE_COLORS.length],
        })),
      })
    }
    if (spec.id === 'tasks_by_priority' && priorityMap.size) {
      charts.push({
        title: t('reports.pdf.tasksByPriority', { defaultValue: 'Tasks by priority' }),
        kind: spec.kind,
        data: [...priorityMap.entries()].map(([label, value], index) => ({
          label: t(`priority.${label}`, { defaultValue: label }),
          value,
          color: PIE_COLORS[index % PIE_COLORS.length],
        })),
      })
    }
    if (spec.id === 'effort_by_project' && projectLoad.size) {
      const projectName = new Map(projects.map((project) => [project.id, project.name]))
      charts.push({
        title: t('reports.pdf.effortByProject'),
        kind: spec.kind,
        data: [...projectLoad.entries()]
          .map(([id, value], index) => ({
            label: projectName.get(id) ?? id.slice(0, 8),
            value: Math.round(value),
            color: PIE_COLORS[index % PIE_COLORS.length],
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8),
      })
    }
    if (spec.id === 'open_by_member' && memberLoad.size) {
      charts.push({
        title: t('reports.pdf.openByMember'),
        kind: spec.kind,
        data: [...memberLoad.entries()]
          .map(([id, value], index) => ({
            label: memberMap.get(id) ?? id.slice(0, 8),
            value,
            color: PIE_COLORS[index % PIE_COLORS.length],
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8),
      })
    }
    if (spec.id === 'completion_trend') {
      const dayKeys = enumerateDayKeys(period.start, period.end)
      if (dayKeys.length) {
        const createdByDay = new Map<string, number>()
        const completedByDay = new Map<string, number>()
        for (const key of dayKeys) {
          createdByDay.set(key, 0)
          completedByDay.set(key, 0)
        }
        for (const task of tasks) {
          const createdKey = task.created_at?.slice(0, 10)
          if (createdKey && createdByDay.has(createdKey)) {
            createdByDay.set(createdKey, (createdByDay.get(createdKey) ?? 0) + 1)
          }
          const doneKey = task.completed_at?.slice(0, 10)
          if (task.status === 'done' && doneKey && completedByDay.has(doneKey)) {
            completedByDay.set(doneKey, (completedByDay.get(doneKey) ?? 0) + 1)
          }
        }
        const createdSeries = dayKeys.map((key) => ({
          label: shortDayLabel(key, lng),
          value: createdByDay.get(key) ?? 0,
        }))
        const completedSeries = dayKeys.map((key) => ({
          label: shortDayLabel(key, lng),
          value: completedByDay.get(key) ?? 0,
        }))
        charts.push({
          title: t('reports.pdf.completionTrend', {
            defaultValue: 'Created vs completed over time',
          }),
          kind: spec.kind === 'bar' || spec.kind === 'pie' ? 'line' : spec.kind,
          data: completedSeries,
          series: [
            {
              name: t('reports.pdf.seriesCreated', { defaultValue: 'Created' }),
              color: '#71717a',
              data: createdSeries,
            },
            {
              name: t('reports.pdf.seriesCompleted', { defaultValue: 'Completed' }),
              color: '#18181b',
              data: completedSeries,
            },
          ],
        })
      }
    }
    if (spec.id === 'project_comparison' && projects.length) {
      const openByProject = new Map<string, number>()
      const doneByProject = new Map<string, number>()
      for (const task of tasks) {
        if (!task.project_id) continue
        if (task.status === 'done') countBy(doneByProject, task.project_id)
        else countBy(openByProject, task.project_id)
      }
      const ranked = projects
        .map((project) => ({
          id: project.id,
          name: project.name,
          open: openByProject.get(project.id) ?? 0,
          done: doneByProject.get(project.id) ?? 0,
          completion: Number(project.completion_pct ?? 0),
        }))
        .sort((a, b) => b.open + b.done - (a.open + a.done))
        .slice(0, 8)
      if (ranked.some((row) => row.open + row.done > 0 || row.completion > 0)) {
        charts.push({
          title: t('reports.pdf.projectComparison', {
            defaultValue: 'Project comparison (open vs completed)',
          }),
          kind: spec.kind === 'pie' ? 'comparison' : spec.kind,
          data: ranked.map((row, index) => ({
            label: row.name,
            value: row.completion || row.done,
            color: PIE_COLORS[index % PIE_COLORS.length],
          })),
          series: [
            {
              name: t('reports.pdf.seriesOpen', { defaultValue: 'Open' }),
              color: '#a1a1aa',
              data: ranked.map((row) => ({ label: row.name, value: row.open })),
            },
            {
              name: t('reports.pdf.seriesCompleted', { defaultValue: 'Completed' }),
              color: '#18181b',
              data: ranked.map((row) => ({ label: row.name, value: row.done })),
            },
          ],
        })
      }
    }
  }

  // Always keep charts section when we produced chart data
  const sections = [...def.sections]
  if (charts.length && !sections.includes('charts')) sections.push('charts')
  if (input.config.metrics.includes('ai_insights') && !sections.includes('ai_insights')) {
    sections.push('ai_insights')
  }

  const tables: ReportTable[] = []
  if (def.sections.includes('projects') || def.sections.includes('appendix')) {
    tables.push({
      title: t('reports.pdf.projects'),
      headers: [
        t('reports.table.project'),
        t('reports.table.health'),
        t('reports.table.progress'),
        t('reports.table.status'),
      ],
      rows: projects.slice(0, 40).map((project) => [
        project.name,
        String(project.health ?? '—'),
        `${Number(project.completion_pct ?? 0)}%`,
        String(project.status ?? '—'),
      ]),
    })
  }
  if (def.sections.includes('tasks') || overdue.length || completedInPeriod.length) {
    const focus =
      input.config.typeId === 'overdue_tasks'
        ? overdue
        : input.config.typeId === 'completed_work'
          ? completedInPeriod
          : open.length
            ? open
            : tasks
    const projectName = new Map(projects.map((project) => [project.id, project.name]))
    tables.push({
      title:
        input.config.typeId === 'completed_work'
          ? t('reports.table.completedTasks')
          : t('reports.table.tasksInFocus'),
      headers: [
        t('reports.table.task'),
        t('reports.table.project'),
        t('reports.table.status'),
        t('reports.table.priority'),
        t('reports.table.due'),
      ],
      rows: focus.slice(0, 50).map((task) => [
        task.title,
        task.project_id ? projectName.get(task.project_id) ?? '—' : '—',
        t(`status.${task.status}`, { defaultValue: task.status }),
        t(`priority.${task.priority}`, { defaultValue: task.priority }),
        taskDueDateKey(task) ?? '—',
      ]),
    })
  }
  if (def.sections.includes('teams') && memberLoad.size) {
    tables.push({
      title: t('reports.pdf.memberWorkload'),
      headers: [t('reports.table.member'), t('reports.table.openTasks')],
      rows: [...memberLoad.entries()]
        .map(([id, value]) => [memberMap.get(id) ?? id.slice(0, 8), String(value)])
        .sort((a, b) => Number(b[1]) - Number(a[1])),
    })
  }

  const insights = [
    ...insightsFromData(overdue.length, completionRate, open.length, t),
    ...(input.aiPromptNotes ?? []),
  ]
  const recommendations = recommendationsFromData(
    {
      overdue: overdue.length,
      open: open.length,
      completionRate,
      completed: completedInPeriod.length,
      created: createdInPeriod.length,
    },
    t,
  )

  const title =
    input.config.title?.trim() ||
    `${typeTitle} · ${period.label}`

  return {
    version: 1,
    os: input.os,
    typeId: input.config.typeId,
    title,
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt: new Date().toISOString(),
    generatedBy: input.generatedBy,
    workspaceName: input.workspaceName ?? null,
    workspaceId: input.workspaceId ?? null,
    branding: {
      productName: 'HILM',
      accent: '#18181b',
      logoUrl: input.logoUrl ?? null,
    },
    executiveSummary: buildExecutiveSummary({
      os: input.os,
      periodLabel: period.label,
      completed: completedInPeriod.length,
      overdue: overdue.length,
      open: open.length,
      projects: projects.length,
      completionRate,
      workspaceName: input.workspaceName,
      pdf,
    }),
    metrics,
    charts,
    tables,
    insights,
    recommendations,
    sections,
    config: input.config,
  }
}

const PIE_COLORS = ['#18181b', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8']

function insightsFromData(
  overdue: number,
  completionRate: number,
  open: number,
  t: ReturnType<typeof i18n.getFixedT>,
) {
  const lines: string[] = []
  if (overdue > 0) {
    lines.push(t('reports.insights.overdue', { count: overdue }))
  } else {
    lines.push(t('reports.insights.noOverdue'))
  }
  if (completionRate >= 70) {
    lines.push(t('reports.insights.strongCompletion', { rate: completionRate }))
  } else if (open > 0) {
    lines.push(t('reports.insights.openCompletion', { rate: completionRate, open }))
  }
  return lines
}

function recommendationsFromData(
  input: {
    overdue: number
    open: number
    completionRate: number
    completed: number
    created: number
  },
  t: ReturnType<typeof i18n.getFixedT>,
) {
  const lines: string[] = []
  if (input.overdue > 0) {
    lines.push(t('reports.recommendations.clearOverdue'))
  }
  if (input.created > input.completed + 2) {
    lines.push(t('reports.recommendations.intakePace'))
  }
  if (input.completionRate < 50 && input.open > 5) {
    lines.push(t('reports.recommendations.breakDown'))
  }
  if (!lines.length) {
    lines.push(t('reports.recommendations.maintain'))
  }
  return lines
}

function buildExecutiveSummary(input: {
  os: ReportOs
  periodLabel: string
  completed: number
  overdue: number
  open: number
  projects: number
  completionRate: number
  workspaceName?: string | null
  pdf: ReturnType<typeof localizedPdfCopy>
}) {
  const scope =
    input.os === 'workspace'
      ? input.workspaceName
        ? input.pdf.workspaceNamed(input.workspaceName)
        : input.pdf.thisWorkspace
      : input.pdf.personalOs
  return input.pdf.summaryTemplate({
    scope,
    period: input.periodLabel,
    completed: input.completed,
    open: input.open,
    overdue: input.overdue,
    projects: input.projects,
    rate: input.completionRate,
  })
}

export function emptyChartGuard(data: ChartDatum[]) {
  return data.filter((row) => Number.isFinite(row.value))
}
