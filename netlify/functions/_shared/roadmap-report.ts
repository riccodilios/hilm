/**
 * Roadmap report: data shaping, metrics, the AI prompt and strict validation of the AI answer.
 * Pure functions; ai-roadmap-report.ts loads the rows with the caller's permissions.
 */

export type Horizon = 'now' | 'next' | 'later' | 'future'
export const HORIZONS: Horizon[] = ['now', 'next', 'later', 'future']

export type ProjectRow = {
  id: string
  name: string
  description: string | null
  status: string | null
  health: string | null
  health_explanation: string | null
  completion_pct: number | null
}

export type StepRow = {
  id: string
  project_id: string
  title: string
  description: string | null
  horizon: Horizon
  position: number | string | null
  starts_at?: string | null
  ends_at?: string | null
  created_at: string
}

export type TaskRow = {
  id: string
  project_id: string | null
  title: string
  status: string
  priority: string
  due_date: string | null
  due_at: string | null
  completed_at: string | null
  created_at: string
  assignee_id?: string | null
}

export type CompletedStepRow = { project_id: string; title: string; completed_at: string }

export type RoadmapStep = {
  id: string
  title: string
  description: string | null
  stage: Horizon | 'done'
  order: number
  startsAt: string | null
  endsAt: string | null
  createdAt: string | null
  completedAt: string | null
}

export type ProjectStats = {
  stepsTotal: number
  stepsByStage: Record<Horizon | 'done', number>
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

export type RoadmapProject = {
  id: string
  name: string
  description: string | null
  status: string | null
  health: string | null
  completionPct: number
  steps: RoadmapStep[]
  stats: ProjectStats
}

export type Readiness = 'done' | 'in_progress' | 'ready' | 'not_started' | 'blocked'
export type ProjectStatus = 'on_track' | 'at_risk' | 'off_track' | 'not_started'

export type RoadmapAnalysis = {
  overview: string
  projects: Array<{
    projectId: string
    status: ProjectStatus
    confidence: number
    summary: string
    progressAssessment: string
    strengths: string[]
    risks: Array<{ title: string; detail: string; severity: 'high' | 'medium' | 'low' }>
    gaps: string[]
    steps: Array<{ stepId: string; readiness: Readiness; relatedTasks: number; note: string }>
    nextActions: string[]
    outlook: string
  }>
  recommendations: string[]
}

const DAY = 86_400_000
const CLOSED = new Set(['done', 'archived', 'cancelled'])

function dateKey(task: Pick<TaskRow, 'due_date' | 'due_at'>) {
  return (task.due_date ?? task.due_at ?? '').slice(0, 10) || null
}

/** Completed steps are removed from the roadmap; their titles come from the activity history. */
export function completedTitleFromSummary(summary: string) {
  const match = summary.match(/^Completed roadmap item (.+?)(?:; advanced Next into Now)?$/)
  return match?.[1]?.trim() || null
}

export function buildRoadmapProjects(input: {
  projects: ProjectRow[]
  steps: StepRow[]
  tasks: TaskRow[]
  completed: CompletedStepRow[]
  periodStart: string
  periodEnd: string
  workspace: boolean
  now?: Date
}): RoadmapProject[] {
  const now = input.now ?? new Date()
  const today = now.toISOString().slice(0, 10)
  const soon = new Date(now.getTime() + 7 * DAY).toISOString().slice(0, 10)
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY).toISOString()

  return input.projects.map((project) => {
    const done = input.completed
      .filter((row) => row.project_id === project.id)
      .sort((a, b) => a.completed_at.localeCompare(b.completed_at))
    const live = input.steps
      .filter((step) => step.project_id === project.id)
      .sort(
        (a, b) =>
          HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon) ||
          Number(a.position ?? 0) - Number(b.position ?? 0) ||
          a.created_at.localeCompare(b.created_at),
      )
    const steps: RoadmapStep[] = [
      ...done.map((row, index) => ({
        id: `done-${project.id.slice(0, 8)}-${index}`,
        title: row.title,
        description: null,
        stage: 'done' as const,
        order: 0,
        startsAt: null,
        endsAt: null,
        createdAt: null,
        completedAt: row.completed_at,
      })),
      ...live.map((step) => ({
        id: step.id,
        title: step.title,
        description: step.description,
        stage: step.horizon,
        order: 0,
        startsAt: step.starts_at ?? null,
        endsAt: step.ends_at ?? null,
        createdAt: step.created_at,
        completedAt: null,
      })),
    ].map((step, index) => ({ ...step, order: index + 1 }))

    const tasks = input.tasks.filter((task) => task.project_id === project.id && task.status !== 'archived')
    const open = tasks.filter((task) => !CLOSED.has(task.status))
    const doneTasks = tasks.filter((task) => task.status === 'done')
    const nowSteps = live.filter((step) => step.horizon === 'now')
    const oldestNow = nowSteps.reduce<number | null>((oldest, step) => {
      const age = Math.floor((now.getTime() - Date.parse(step.created_at)) / DAY)
      return oldest == null || age > oldest ? age : oldest
    }, null)

    const stepsByStage = { done: done.length, now: 0, next: 0, later: 0, future: 0 } as ProjectStats['stepsByStage']
    for (const step of live) stepsByStage[step.horizon] += 1

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      health: project.health,
      completionPct: Number(project.completion_pct ?? 0),
      steps,
      stats: {
        stepsTotal: steps.length,
        stepsByStage,
        completedInPeriod: done.filter((row) => {
          const key = row.completed_at.slice(0, 10)
          return key >= input.periodStart && key <= input.periodEnd
        }).length,
        oldestNowDays: oldestNow,
        tasksTotal: tasks.length,
        tasksOpen: open.length,
        tasksDone: doneTasks.length,
        tasksOverdue: open.filter((task) => {
          const key = dateKey(task)
          return Boolean(key && key < today)
        }).length,
        tasksDueSoon: open.filter((task) => {
          const key = dateKey(task)
          return Boolean(key && key >= today && key <= soon)
        }).length,
        urgentOpen: open.filter((task) => task.priority === 'urgent' || task.priority === 'high').length,
        completedLast14d: doneTasks.filter((task) => (task.completed_at ?? '') >= twoWeeksAgo).length,
        createdLast14d: tasks.filter((task) => task.created_at >= twoWeeksAgo).length,
        unassignedOpen: input.workspace ? open.filter((task) => !task.assignee_id).length : null,
        taskCompletionPct: tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0,
      },
    }
  })
}

const clip = (value: string | null | undefined, max: number) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Compact, bounded context for the model: every step, the most relevant tasks per project. */
export function analysisContext(projects: RoadmapProject[], tasks: TaskRow[], periodStart: string, periodEnd: string) {
  const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
  return {
    period: { start: periodStart, end: periodEnd },
    today: new Date().toISOString().slice(0, 10),
    projects: projects.map((project) => {
      const own = tasks.filter((task) => task.project_id === project.id && task.status !== 'archived')
      const open = own
        .filter((task) => !CLOSED.has(task.status))
        .sort(
          (a, b) =>
            (priorityRank[a.priority] ?? 5) - (priorityRank[b.priority] ?? 5) ||
            (dateKey(a) ?? '9999').localeCompare(dateKey(b) ?? '9999'),
        )
        .slice(0, 60)
      const recentDone = own
        .filter((task) => task.status === 'done')
        .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
        .slice(0, 20)
      return {
        projectId: project.id,
        name: clip(project.name, 120),
        description: clip(project.description, 400),
        status: project.status,
        health: project.health,
        storedCompletionPct: project.completionPct,
        metrics: project.stats,
        roadmap: project.steps.slice(0, 60).map((step) => ({
          stepId: step.id,
          order: step.order,
          stage: step.stage,
          title: clip(step.title, 160),
          description: clip(step.description, 300),
          startsAt: step.startsAt,
          endsAt: step.endsAt,
          createdAt: step.createdAt?.slice(0, 10) ?? null,
          completedAt: step.completedAt?.slice(0, 10) ?? null,
        })),
        openTasks: open.map((task) => ({
          title: clip(task.title, 140),
          status: task.status,
          priority: task.priority,
          due: dateKey(task),
          ...(task.assignee_id !== undefined ? { assigned: Boolean(task.assignee_id) } : {}),
        })),
        recentlyCompletedTasks: recentDone.map((task) => ({
          title: clip(task.title, 140),
          completed: task.completed_at?.slice(0, 10) ?? null,
        })),
      }
    }),
  }
}

export function analysisPrompt(locale: 'en' | 'ar') {
  const language =
    locale === 'ar'
      ? 'Write every narrative value in Modern Standard Arabic. Keep JSON keys, ids and enum values in English.'
      : 'Write every narrative value in English.'
  return `You are Hilm's delivery analyst. You review project roadmaps against the project's real task data and write a concise, specific analysis for a PDF report.
${language}
Rules:
- Use ONLY the data provided. Never invent steps, tasks, dates, people or numbers. Cite concrete step titles, task counts and dates.
- Roadmap stages: done (completed earlier), now (in progress), next, later, future.
- Judge each step's readiness from the related tasks (match by meaning of the titles). If no task supports a "now" step, say so.
- Velocity = tasks completed in the last 14 days; compare it with open and overdue work to judge the timeline.
- Be direct and useful: risks with a reason, gaps between roadmap and tasks, and next actions someone can do this week.
Return ONLY valid JSON:
{
  "overview": "3-5 sentences across all projects",
  "projects": [
    {
      "projectId": "<projectId from the data>",
      "status": "on_track" | "at_risk" | "off_track" | "not_started",
      "confidence": 0-100,
      "summary": "3-4 sentences",
      "progressAssessment": "how roadmap progress compares with task progress and velocity",
      "strengths": ["up to 4"],
      "risks": [{ "title": "short", "detail": "why, with evidence", "severity": "high" | "medium" | "low" }],
      "gaps": ["roadmap steps without supporting tasks, or significant work outside the roadmap; up to 5"],
      "steps": [{ "stepId": "<stepId>", "readiness": "done" | "in_progress" | "ready" | "not_started" | "blocked", "relatedTasks": 0, "note": "one sentence" }],
      "nextActions": ["up to 5 concrete actions"],
      "outlook": "timeline outlook for the now and next stages"
    }
  ],
  "recommendations": ["up to 6 portfolio-level recommendations"]
}`
}

const STATUSES: ProjectStatus[] = ['on_track', 'at_risk', 'off_track', 'not_started']
const READINESS: Readiness[] = ['done', 'in_progress', 'ready', 'not_started', 'blocked']
const SEVERITY = ['high', 'medium', 'low'] as const

const text = (value: unknown, max: number) => (typeof value === 'string' ? clip(value, max) : '')
const list = (value: unknown, maxItems: number, maxLen: number) =>
  (Array.isArray(value) ? value : [])
    .map((item) => text(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems)

/** Accepts only known projects and steps, known enum values and bounded text. */
export function sanitizeAnalysis(raw: unknown, projects: RoadmapProject[]): RoadmapAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const byId = new Map(projects.map((project) => [project.id, project]))
  const seen = new Set<string>()
  const out: RoadmapAnalysis['projects'] = []
  for (const item of Array.isArray(data.projects) ? data.projects : []) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const project = byId.get(String(row.projectId ?? ''))
    if (!project || seen.has(project.id)) continue
    seen.add(project.id)
    const stepIds = new Set(project.steps.map((step) => step.id))
    const stepSeen = new Set<string>()
    out.push({
      projectId: project.id,
      status: STATUSES.includes(row.status as ProjectStatus) ? (row.status as ProjectStatus) : 'at_risk',
      confidence: Math.max(0, Math.min(100, Math.round(Number(row.confidence) || 0))),
      summary: text(row.summary, 900),
      progressAssessment: text(row.progressAssessment, 700),
      strengths: list(row.strengths, 4, 240),
      risks: (Array.isArray(row.risks) ? row.risks : [])
        .map((risk) => {
          const r = (risk ?? {}) as Record<string, unknown>
          const severity = SEVERITY.includes(r.severity as (typeof SEVERITY)[number]) ? (r.severity as (typeof SEVERITY)[number]) : 'medium'
          return { title: text(r.title, 120), detail: text(r.detail, 320), severity }
        })
        .filter((risk) => risk.title)
        .slice(0, 5),
      gaps: list(row.gaps, 5, 260),
      steps: (Array.isArray(row.steps) ? row.steps : [])
        .map((step) => {
          const s = (step ?? {}) as Record<string, unknown>
          const stepId = String(s.stepId ?? '')
          if (!stepIds.has(stepId) || stepSeen.has(stepId)) return null
          stepSeen.add(stepId)
          return {
            stepId,
            readiness: READINESS.includes(s.readiness as Readiness) ? (s.readiness as Readiness) : 'not_started',
            relatedTasks: Math.max(0, Math.min(999, Math.round(Number(s.relatedTasks) || 0))),
            note: text(s.note, 260),
          }
        })
        .filter((step): step is NonNullable<typeof step> => step !== null),
      nextActions: list(row.nextActions, 5, 240),
      outlook: text(row.outlook, 500),
    })
  }
  const overview = text(data.overview, 1400)
  if (!overview && !out.length) return null
  return { overview, projects: out, recommendations: list(data.recommendations, 6, 260) }
}

export function extractJsonObject(content: string): Record<string, unknown> | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] ?? content).trim()
  for (const candidate of [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // try the next candidate
    }
  }
  return null
}
