import type { TFunction } from 'i18next'
import type { MetricId, ReportTypeDefinition, ReportTypeId } from '@/shared/reports/types'
import { ALL_METRICS, getReportType, listReportTypes } from '@/shared/reports/catalog'
import type { ReportOs } from '@/shared/reports/types'

export function localizedReportType(
  os: ReportOs,
  id: ReportTypeId,
  t: TFunction,
): ReportTypeDefinition {
  const base = getReportType(os, id)
  return {
    ...base,
    title: t(`reports.types.${id}.title`, { defaultValue: base.title }),
    description: t(`reports.types.${id}.description`, { defaultValue: base.description }),
  }
}

export function listLocalizedReportTypes(os: ReportOs, t: TFunction) {
  return listReportTypes(os).map((item) => localizedReportType(os, item.id, t))
}

export function localizedMetricLabel(id: MetricId, t: TFunction) {
  const fallback = ALL_METRICS.find((metric) => metric.id === id)?.label ?? id
  return t(`reports.metrics.${id}`, { defaultValue: fallback })
}

export function localizedPdfCopy(t: TFunction) {
  return {
    executiveSummary: t('reports.pdf.executiveSummary'),
    keyMetrics: t('reports.pdf.keyMetrics'),
    detailedAnalysis: t('reports.pdf.detailedAnalysis'),
    aiInsights: t('reports.pdf.aiInsights'),
    recommendations: t('reports.pdf.recommendations'),
    charts: t('reports.pdf.charts'),
    tasks: t('reports.pdf.tasks'),
    projects: t('reports.pdf.projects'),
    teams: t('reports.pdf.teams'),
    appendix: t('reports.pdf.appendix'),
    generatedAt: (when: string) => t('reports.pdf.generatedAt', { when }),
    personalOs: t('reports.pdf.personalOs'),
    thisWorkspace: t('reports.pdf.thisWorkspace'),
    workspaceNamed: (name: string) => t('reports.pdf.workspaceNamed', { name }),
    summaryTemplate: (vars: {
      scope: string
      period: string
      completed: number
      open: number
      overdue: number
      projects: number
      rate: number
    }) => t('reports.pdf.summaryTemplate', vars),
  }
}
