import { getReportType } from '@/features/reports/catalog'
import { resolveReportPeriod } from '@/features/reports/date-ranges'
import type {
  ChartDatum,
  MetricId,
  ReportConfig,
  ReportMetric,
  ReportOs,
  ReportSnapshot,
  ReportTable,
} from '@/features/reports/types'
import { taskDueDateKey, todayLocalISO } from '@/lib/dates'

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

function metricLabel(id: MetricId) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function buildReportSnapshot(input: ReportBuildInput): ReportSnapshot {
  const def = getReportType(input.os, input.config.typeId)
  const period = resolveReportPeriod(
    input.config.datePreset,
    input.config.customStart,
    input.config.customEnd,
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
        return { id, label: metricLabel(id), value: createdInPeriod.length }
      case 'tasks_completed':
        return { id, label: metricLabel(id), value: completedInPeriod.length }
      case 'completion_rate':
        return { id, label: metricLabel(id), value: `${completionRate}%` }
      case 'overdue_tasks':
        return { id, label: metricLabel(id), value: overdue.length }
      case 'open_tasks':
        return { id, label: metricLabel(id), value: open.length }
      case 'project_count':
        return { id, label: metricLabel(id), value: projects.length }
      case 'project_progress': {
        const avg =
          projects.length === 0
            ? 0
            : Math.round(
                projects.reduce((sum, project) => sum + Number(project.completion_pct ?? 0), 0) /
                  projects.length,
              )
        return { id, label: metricLabel(id), value: `${avg}%` }
      }
      case 'project_health': {
        const blocked = projects.filter((project) =>
          ['blocked', 'critical', 'stalled', 'warning'].includes(String(project.health ?? '')),
        ).length
        return { id, label: 'At-risk projects', value: blocked }
      }
      case 'time_allocation':
        return {
          id,
          label: metricLabel(id),
          value: Math.round([...projectLoad.values()].reduce((a, b) => a + b, 0)),
          hint: 'Estimated hours across selected projects',
        }
      case 'workload':
        return { id, label: metricLabel(id), value: open.length, hint: 'Open tasks in scope' }
      case 'member_workload':
        return {
          id,
          label: metricLabel(id),
          value: memberLoad.size,
          hint: 'Assignees with open work',
        }
      case 'team_capacity':
        return {
          id,
          label: metricLabel(id),
          value: Math.max(0, (input.members?.length ?? 0) * 5 - open.length),
          hint: 'Rough remaining capacity units',
        }
      case 'productivity_trend':
        return {
          id,
          label: metricLabel(id),
          value: completedInPeriod.length - createdInPeriod.length,
          hint: 'Completed minus created in period',
        }
      case 'upcoming_deadlines':
        return { id, label: metricLabel(id), value: upcoming.length }
      case 'ai_insights':
        return {
          id,
          label: metricLabel(id),
          value: input.aiPromptNotes?.length ?? insightsFromData(overdue.length, completionRate, open.length).length,
        }
      default:
        return { id, label: metricLabel(id), value: '—' }
    }
  })

  const charts: ReportSnapshot['charts'] = []
  if (statusMap.size) {
    charts.push({
      title: 'Tasks by status',
      kind: 'bar',
      data: [...statusMap.entries()].map(([label, value]) => ({ label, value })),
    })
  }
  if (priorityMap.size) {
    charts.push({
      title: 'Tasks by priority',
      kind: 'pie',
      data: [...priorityMap.entries()].map(([label, value], index) => ({
        label,
        value,
        color: PIE_COLORS[index % PIE_COLORS.length],
      })),
    })
  }
  if (projectLoad.size) {
    const projectName = new Map(projects.map((project) => [project.id, project.name]))
    charts.push({
      title: 'Estimated effort by project',
      kind: 'bar',
      data: [...projectLoad.entries()]
        .map(([id, value]) => ({ label: projectName.get(id) ?? id.slice(0, 8), value: Math.round(value) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    })
  }
  if (memberLoad.size) {
    charts.push({
      title: 'Open tasks by member',
      kind: 'bar',
      data: [...memberLoad.entries()]
        .map(([id, value]) => ({ label: memberMap.get(id) ?? id.slice(0, 8), value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    })
  }

  const tables: ReportTable[] = []
  if (def.sections.includes('projects') || def.sections.includes('appendix')) {
    tables.push({
      title: 'Projects',
      headers: ['Project', 'Health', 'Progress', 'Status'],
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
      title: input.config.typeId === 'completed_work' ? 'Completed tasks' : 'Tasks in focus',
      headers: ['Task', 'Project', 'Status', 'Priority', 'Due'],
      rows: focus.slice(0, 50).map((task) => [
        task.title,
        task.project_id ? projectName.get(task.project_id) ?? '—' : '—',
        task.status,
        task.priority,
        taskDueDateKey(task) ?? '—',
      ]),
    })
  }
  if (def.sections.includes('teams') && memberLoad.size) {
    tables.push({
      title: 'Member workload',
      headers: ['Member', 'Open tasks'],
      rows: [...memberLoad.entries()]
        .map(([id, value]) => [memberMap.get(id) ?? id.slice(0, 8), String(value)])
        .sort((a, b) => Number(b[1]) - Number(a[1])),
    })
  }

  const insights = [
    ...insightsFromData(overdue.length, completionRate, open.length),
    ...(input.aiPromptNotes ?? []),
  ]
  const recommendations = recommendationsFromData({
    overdue: overdue.length,
    open: open.length,
    completionRate,
    completed: completedInPeriod.length,
    created: createdInPeriod.length,
  })

  const title =
    input.config.title?.trim() ||
    `${def.title} · ${period.label}`

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
    }),
    metrics,
    charts,
    tables,
    insights,
    recommendations,
    sections: def.sections,
    config: input.config,
  }
}

const PIE_COLORS = ['#18181b', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8']

function insightsFromData(overdue: number, completionRate: number, open: number) {
  const lines: string[] = []
  if (overdue > 0) {
    lines.push(`${overdue} overdue task${overdue === 1 ? '' : 's'} need attention before new commitments.`)
  } else {
    lines.push('No overdue tasks in the selected scope — execution is currently on track.')
  }
  if (completionRate >= 70) {
    lines.push(`Completion rate is strong at ${completionRate}%.`)
  } else if (open > 0) {
    lines.push(`Completion rate is ${completionRate}% with ${open} open items still in flight.`)
  }
  return lines
}

function recommendationsFromData(input: {
  overdue: number
  open: number
  completionRate: number
  completed: number
  created: number
}) {
  const lines: string[] = []
  if (input.overdue > 0) {
    lines.push('Clear overdue work first, then re-balance the remaining open queue.')
  }
  if (input.created > input.completed + 2) {
    lines.push('Intake is outpacing completion — protect focus time or reduce new commitments.')
  }
  if (input.completionRate < 50 && input.open > 5) {
    lines.push('Break large open items into smaller deliverables to restore momentum.')
  }
  if (!lines.length) {
    lines.push('Maintain current cadence and schedule a mid-period checkpoint on high-priority projects.')
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
}) {
  const scope =
    input.os === 'workspace'
      ? input.workspaceName
        ? `Workspace “${input.workspaceName}”`
        : 'This workspace'
      : 'Personal OS'
  return `${scope} for ${input.periodLabel}: ${input.completed} tasks completed, ${input.open} open, ${input.overdue} overdue across ${input.projects} projects. Overall completion rate is ${input.completionRate}%.`
}

export function emptyChartGuard(data: ChartDatum[]) {
  return data.filter((row) => Number.isFinite(row.value))
}
