/** Mirrors netlify/functions/_shared/roadmap-report.ts (the server validates the AI part). */
export type RoadmapStage = 'done' | 'now' | 'next' | 'later' | 'future'
export const ROADMAP_STAGES: RoadmapStage[] = ['done', 'now', 'next', 'later', 'future']

export type RoadmapReportStep = {
  id: string
  title: string
  description: string | null
  stage: RoadmapStage
  order: number
  startsAt: string | null
  endsAt: string | null
  createdAt: string | null
  completedAt: string | null
}

export type RoadmapReportStats = {
  stepsTotal: number
  stepsByStage: Record<RoadmapStage, number>
  completedInPeriod: number
  oldestNowDays: number | null
  tasksTotal: number
  tasksOpen: number
  tasksDone: number
  tasksOverdue: number
  tasksDueSoon: number
  urgentOpen: number
  completedLast14d: number
  createdLast14d: number
  unassignedOpen: number | null
  taskCompletionPct: number
}

export type RoadmapReportProject = {
  id: string
  name: string
  description: string | null
  status: string | null
  health: string | null
  completionPct: number
  steps: RoadmapReportStep[]
  stats: RoadmapReportStats
}

export type RoadmapReadiness = 'done' | 'in_progress' | 'ready' | 'not_started' | 'blocked'
export type RoadmapProjectStatus = 'on_track' | 'at_risk' | 'off_track' | 'not_started'

export type RoadmapAnalysis = {
  overview: string
  projects: Array<{
    projectId: string
    status: RoadmapProjectStatus
    confidence: number
    summary: string
    progressAssessment: string
    strengths: string[]
    risks: Array<{ title: string; detail: string; severity: 'high' | 'medium' | 'low' }>
    gaps: string[]
    steps: Array<{ stepId: string; readiness: RoadmapReadiness; relatedTasks: number; note: string }>
    nextActions: string[]
    outlook: string
  }>
  recommendations: string[]
}

export type RoadmapReportData = {
  projects: RoadmapReportProject[]
  analysis: RoadmapAnalysis | null
  /** Why the AI section is missing (quota, disabled, provider), shown in the report. */
  aiError: string | null
}

/** Short codes from the server become readable text; quota and provider messages pass through. */
export function roadmapAiReason(code: string, t: (key: string, options?: Record<string, unknown>) => string) {
  return t(`reports.roadmap.errors.${code}`, { defaultValue: code })
}
