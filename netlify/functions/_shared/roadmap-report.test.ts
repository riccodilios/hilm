import { describe, expect, it } from 'vitest'
import {
  analysisContext,
  buildRoadmapProjects,
  completedTitleFromSummary,
  extractJsonObject,
  sanitizeAnalysis,
  type StepRow,
  type TaskRow,
} from './roadmap-report.ts'

const now = new Date('2026-11-02T12:00:00Z')
const project = { id: 'p1', name: 'App launch', description: 'Ship v1', status: 'active', health: 'healthy', health_explanation: null, completion_pct: 40 }
const step = (id: string, horizon: StepRow['horizon'], position: number, created = '2026-10-01T00:00:00Z'): StepRow => ({
  id,
  project_id: 'p1',
  title: `Step ${id}`,
  description: null,
  horizon,
  position,
  created_at: created,
})
const task = (patch: Partial<TaskRow>): TaskRow => ({
  id: Math.random().toString(36),
  project_id: 'p1',
  title: 'Task',
  status: 'todo',
  priority: 'medium',
  due_date: null,
  due_at: null,
  completed_at: null,
  created_at: '2026-10-20T00:00:00Z',
  ...patch,
})

function build(workspace = false) {
  return buildRoadmapProjects({
    projects: [project],
    steps: [step('b', 'next', 2), step('a', 'now', 5, '2026-10-12T12:00:00Z'), step('c', 'later', 1), step('d', 'now', 1, '2026-10-22T12:00:00Z')],
    tasks: [
      task({ status: 'done', completed_at: '2026-10-30T10:00:00Z' }),
      task({ status: 'done', completed_at: '2026-09-01T10:00:00Z' }),
      task({ due_date: '2026-10-30', priority: 'urgent' }),
      task({ due_date: '2026-11-05', assignee_id: 'u1' }),
      task({ status: 'archived' }),
    ],
    completed: [{ project_id: 'p1', title: 'Discovery', completed_at: '2026-10-15T09:00:00Z' }],
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    workspace,
    now,
  })
}

describe('roadmap report data', () => {
  it('orders steps done → now → next → later, numbered as one path', () => {
    const [p] = build()
    expect(p!.steps.map((s) => [s.stage, s.title, s.order])).toEqual([
      ['done', 'Discovery', 1],
      ['now', 'Step d', 2],
      ['now', 'Step a', 3],
      ['next', 'Step b', 4],
      ['later', 'Step c', 5],
    ])
  })

  it('computes task and roadmap metrics from real rows only', () => {
    const [p] = build(true)
    expect(p!.stats).toMatchObject({
      stepsTotal: 5,
      stepsByStage: { done: 1, now: 2, next: 1, later: 1, future: 0 },
      completedInPeriod: 1,
      oldestNowDays: 21,
      tasksTotal: 4,
      tasksOpen: 2,
      tasksDone: 2,
      tasksOverdue: 1,
      tasksDueSoon: 1,
      urgentOpen: 1,
      completedLast14d: 1,
      unassignedOpen: 1,
      taskCompletionPct: 50,
    })
    expect(build(false)[0]!.stats.unassignedOpen).toBeNull()
  })

  it('reads completed step titles from old and new activity summaries', () => {
    expect(completedTitleFromSummary('Completed roadmap item Beta release')).toBe('Beta release')
    expect(completedTitleFromSummary('Completed roadmap item Beta; advanced Next into Now')).toBe('Beta')
    expect(completedTitleFromSummary('Added roadmap item X')).toBeNull()
  })

  it('bounds the AI context', () => {
    const context = analysisContext(build(), [task({ title: 'x'.repeat(500) })], '2026-10-01', '2026-10-31')
    expect(context.projects[0]!.openTasks[0]!.title.length).toBeLessThanOrEqual(140)
    expect(context.projects[0]!.roadmap).toHaveLength(5)
  })
})

describe('AI answer validation', () => {
  const projects = build()
  it('keeps only known projects and steps, valid enums and bounded text', () => {
    const analysis = sanitizeAnalysis(
      {
        overview: 'Overall fine.',
        projects: [
          {
            projectId: 'p1',
            status: 'at_risk',
            confidence: 140,
            summary: 's'.repeat(2000),
            strengths: ['a', 'b', 'c', 'd', 'e', 'f'],
            risks: [{ title: 'Scope', detail: 'Too much', severity: 'extreme' }, { detail: 'no title' }],
            steps: [
              { stepId: 'a', readiness: 'in_progress', relatedTasks: 3, note: 'ok' },
              { stepId: 'invented', readiness: 'done' },
              { stepId: 'a', readiness: 'done' },
              { stepId: 'b', readiness: 'flying' },
            ],
            nextActions: ['Do X'],
          },
          { projectId: 'someone-elses-project', status: 'on_track' },
        ],
        recommendations: ['R1'],
      },
      projects,
    )!
    expect(analysis.projects).toHaveLength(1)
    const p = analysis.projects[0]!
    expect(p.confidence).toBe(100)
    expect(p.summary.length).toBeLessThanOrEqual(900)
    expect(p.strengths).toHaveLength(4)
    expect(p.risks).toEqual([{ title: 'Scope', detail: 'Too much', severity: 'medium' }])
    expect(p.steps).toEqual([
      { stepId: 'a', readiness: 'in_progress', relatedTasks: 3, note: 'ok' },
      { stepId: 'b', readiness: 'not_started', relatedTasks: 0, note: '' },
    ])
  })

  it('rejects empty or unreadable answers', () => {
    expect(sanitizeAnalysis({ projects: [] }, projects)).toBeNull()
    expect(sanitizeAnalysis('nope', projects)).toBeNull()
    expect(extractJsonObject('```json\n{"overview":"x"}\n```')).toEqual({ overview: 'x' })
    expect(extractJsonObject('Sure! {"overview":"y"} hope this helps')).toEqual({ overview: 'y' })
    expect(extractJsonObject('no json')).toBeNull()
  })
})
