import type { TFunction } from 'i18next'
import type { RoadmapReportData } from '@/shared/reports/roadmap'
import type { ReportMetric, ReportSnapshot } from '@/shared/reports/types'

/** Turns the roadmap data (and AI analysis, when present) into the report's summary, metrics and chart. */
export function applyRoadmapData(snapshot: ReportSnapshot, data: RoadmapReportData, t: TFunction, customTitle?: string): ReportSnapshot {
  const totals = data.projects.reduce(
    (sum, project) => {
      const s = project.stats
      sum.steps += s.stepsTotal
      sum.done += s.stepsByStage.done
      sum.now += s.stepsByStage.now
      sum.upcoming += s.stepsByStage.next + s.stepsByStage.later + s.stepsByStage.future
      sum.open += s.tasksOpen
      sum.overdue += s.tasksOverdue
      sum.dueSoon += s.tasksDueSoon
      sum.velocity += s.completedLast14d
      sum.tasks += s.tasksTotal
      sum.tasksDone += s.tasksDone
      return sum
    },
    { steps: 0, done: 0, now: 0, upcoming: 0, open: 0, overdue: 0, dueSoon: 0, velocity: 0, tasks: 0, tasksDone: 0 },
  )

  const metric = (id: string, value: string | number, hint?: string): ReportMetric => ({
    id: id as ReportMetric['id'],
    label: t(`reports.roadmap.metrics.${id}`),
    value,
    ...(hint ? { hint } : {}),
  })
  const metrics: ReportMetric[] = [
    metric('steps', totals.steps),
    metric('done', totals.done),
    metric('now', totals.now),
    metric('upcoming', totals.upcoming),
    metric('completion', `${totals.tasks ? Math.round((totals.tasksDone / totals.tasks) * 100) : 0}%`),
    metric('openTasks', totals.open),
    metric('overdue', totals.overdue),
    metric('dueSoon', totals.dueSoon),
    metric('velocity', totals.velocity),
  ]

  const stageOrder = ['done', 'now', 'next', 'later', 'future'] as const
  const byStage = stageOrder.map((stage) => ({
    label: t(`reports.roadmap.stage.${stage}`),
    value: data.projects.reduce((sum, project) => sum + project.stats.stepsByStage[stage], 0),
    color: stage === 'done' ? '#18181b' : stage === 'now' ? '#3f3f46' : stage === 'next' ? '#71717a' : '#a1a1aa',
  }))

  const names = data.projects.map((project) => project.name)
  const typeTitle = t('reports.types.roadmap.title')
  const title =
    customTitle?.trim() ||
    `${typeTitle} · ${names.length <= 2 ? names.join(', ') : t('reports.roadmap.projectCount', { count: names.length })}`

  return {
    ...snapshot,
    title,
    executiveSummary:
      data.analysis?.overview ||
      t('reports.roadmap.summaryFallback', {
        projects: data.projects.length,
        steps: totals.steps,
        done: totals.done,
        now: totals.now,
        upcoming: totals.upcoming,
        open: totals.open,
        overdue: totals.overdue,
        velocity: totals.velocity,
      }),
    metrics,
    charts: totals.steps ? [{ title: t('reports.roadmap.chartStages'), kind: 'column', data: byStage }] : [],
    tables: [],
    insights: [],
    recommendations: data.analysis?.recommendations ?? [],
    sections: ['cover', 'executive_summary', 'key_metrics', ...(totals.steps ? (['charts'] as const) : []), 'roadmap', 'ai_analysis'],
    roadmap: data,
  }
}
