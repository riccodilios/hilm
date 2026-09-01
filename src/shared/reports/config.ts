import type { ReportConfig, ReportOs } from '@/shared/reports/types'

export function defaultConfig(os: ReportOs): ReportConfig {
  return {
    typeId: os === 'workspace' ? 'workspace_overview' : 'weekly_productivity',
    datePreset: 'this_week',
    projectIds: 'all',
    departmentIds: 'all',
    teamIds: 'all',
    memberIds: 'all',
    metrics: [],
  }
}
