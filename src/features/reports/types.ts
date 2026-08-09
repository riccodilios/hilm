/** Shared report engine types — Personal OS and Workspace OS. */

export type ReportOs = 'personal' | 'workspace'

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom'

export type MetricId =
  | 'tasks_created'
  | 'tasks_completed'
  | 'completion_rate'
  | 'overdue_tasks'
  | 'open_tasks'
  | 'project_count'
  | 'project_progress'
  | 'project_health'
  | 'time_allocation'
  | 'workload'
  | 'member_workload'
  | 'team_capacity'
  | 'productivity_trend'
  | 'upcoming_deadlines'
  | 'ai_insights'

export type ReportTypeId =
  | 'productivity'
  | 'weekly_productivity'
  | 'monthly_productivity'
  | 'task'
  | 'overdue_tasks'
  | 'completed_work'
  | 'project'
  | 'project_progress'
  | 'project_health'
  | 'roadmap_progress'
  | 'workload'
  | 'time_allocation'
  | 'ai_activity'
  | 'workspace_overview'
  | 'team_performance'
  | 'department_performance'
  | 'team_workload'
  | 'sprint'
  | 'custom'

export type ReportSectionId =
  | 'cover'
  | 'executive_summary'
  | 'key_metrics'
  | 'charts'
  | 'detailed_analysis'
  | 'projects'
  | 'tasks'
  | 'teams'
  | 'ai_insights'
  | 'recommendations'
  | 'appendix'

export type ReportConfig = {
  typeId: ReportTypeId
  title?: string
  datePreset: DateRangePreset
  customStart?: string
  customEnd?: string
  projectIds: string[] | 'all'
  departmentIds?: string[] | 'all'
  teamIds?: string[] | 'all'
  memberIds?: string[] | 'all'
  metrics: MetricId[]
  aiPrompt?: string
  locale?: 'en' | 'ar'
}

export type ChartDatum = { label: string; value: number; color?: string }

export type ReportMetric = {
  id: MetricId
  label: string
  value: string | number
  hint?: string
}

export type ReportTable = {
  title: string
  headers: string[]
  rows: string[][]
}

export type ReportSnapshot = {
  version: 1
  os: ReportOs
  typeId: ReportTypeId
  title: string
  periodStart: string
  periodEnd: string
  generatedAt: string
  generatedBy: string
  workspaceName?: string | null
  workspaceId?: string | null
  branding: {
    productName: string
    accent: string
    logoUrl?: string | null
  }
  executiveSummary: string
  metrics: ReportMetric[]
  charts: Array<{ title: string; kind: 'bar' | 'pie'; data: ChartDatum[] }>
  tables: ReportTable[]
  insights: string[]
  recommendations: string[]
  sections: ReportSectionId[]
  config: ReportConfig
}

export type ReportTypeDefinition = {
  id: ReportTypeId
  os: ReportOs | 'both'
  title: string
  description: string
  defaultMetrics: MetricId[]
  sections: ReportSectionId[]
  needsDepartments?: boolean
  needsTeams?: boolean
  needsMembers?: boolean
}
