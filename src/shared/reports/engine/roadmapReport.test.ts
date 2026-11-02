import { describe, expect, it, vi } from 'vitest'

// The app's i18n module labels the document on load; node tests have no DOM.
vi.hoisted(() => {
  Object.assign(globalThis, { document: { documentElement: { dataset: {} }, title: '' } })
})

import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import i18n from '@/i18n'
import { buildReportSnapshot } from '@/shared/reports/engine/buildSnapshot'
import { applyRoadmapData } from '@/shared/reports/engine/roadmapSnapshot'
import { customizeReportFromPrompt } from '@/shared/reports/engine/aiCustomize'
import { HilmReportDocument } from '@/shared/reports/pdf/HilmReportDocument'
import type { RoadmapReportData, RoadmapReportStep } from '@/shared/reports/roadmap'

const steps: RoadmapReportStep[] = [
  { id: 'd0', title: 'Discovery', description: null, stage: 'done', order: 1, startsAt: null, endsAt: null, createdAt: null, completedAt: '2026-10-10T10:00:00Z' },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `s${i}`,
    title: `Step ${i} with a reasonably long title to test wrapping in the node card`,
    description: i === 0 ? 'Build the onboarding flow and connect billing.' : null,
    stage: (['now', 'now', 'next', 'next', 'next', 'next', 'next', 'next', 'later'] as const)[i]!,
    order: i + 2,
    startsAt: null,
    endsAt: i === 2 ? '2026-12-01' : null,
    createdAt: '2026-10-01T00:00:00Z',
    completedAt: null,
  })),
]

const data: RoadmapReportData = {
  projects: [
    {
      id: 'p1',
      name: 'App launch',
      description: 'Ship v1 to customers.',
      status: 'active',
      health: 'healthy',
      completionPct: 40,
      steps,
      stats: {
        stepsTotal: 10,
        stepsByStage: { done: 1, now: 2, next: 6, later: 1, future: 0 },
        completedInPeriod: 1,
        oldestNowDays: 32,
        tasksTotal: 20,
        tasksOpen: 12,
        tasksDone: 8,
        tasksOverdue: 3,
        tasksDueSoon: 4,
        urgentOpen: 2,
        completedLast14d: 5,
        createdLast14d: 6,
        unassignedOpen: 2,
        taskCompletionPct: 40,
      },
    },
  ],
  analysis: {
    overview: 'One project, steady but behind on the Now stage.',
    projects: [
      {
        projectId: 'p1',
        status: 'at_risk',
        confidence: 62,
        summary: 'Onboarding is moving; billing has no tasks yet.',
        progressAssessment: 'Task completion 40% vs 10% of roadmap done.',
        strengths: ['Discovery finished on time'],
        risks: [{ title: 'Billing unplanned', detail: 'No tasks support step 3.', severity: 'high' }],
        gaps: ['Step 3 has no tasks'],
        steps: [
          { stepId: 's0', readiness: 'in_progress', relatedTasks: 4, note: 'Most tasks are underway.' },
          { stepId: 's1', readiness: 'blocked', relatedTasks: 0, note: 'Waiting on billing provider.' },
          { stepId: 's2', readiness: 'ready', relatedTasks: 1, note: 'Can start next week.' },
        ],
        nextActions: ['Create billing tasks', 'Assign the 2 unassigned tasks'],
        outlook: 'Now stage likely in 3 weeks at the current pace.',
      },
    ],
    recommendations: ['Plan billing before starting Next items'],
  },
  aiError: null,
}

const doc = (snap: ReturnType<typeof snapshot>) =>
  createElement(HilmReportDocument, { snapshot: snap }) as unknown as Parameters<typeof renderToBuffer>[0]

function snapshot(locale: 'en' | 'ar', withAnalysis = true) {
  const base = buildReportSnapshot({
    os: 'workspace',
    config: { typeId: 'roadmap', datePreset: 'this_month', projectIds: ['p1'], metrics: [], locale },
    generatedBy: 'Tester',
    workspaceName: 'Acme',
    projects: [{ id: 'p1', name: 'App launch' }],
    tasks: [],
  })
  return applyRoadmapData(base, withAnalysis ? data : { ...data, analysis: null, aiError: 'quota reached' }, i18n.getFixedT(locale))
}

describe('roadmap report', () => {
  it('summarizes the roadmap into metrics, a stage chart and roadmap sections', () => {
    const snap = snapshot('en')
    expect(snap.title).toBe('Roadmap Report · App launch')
    expect(snap.sections).toEqual(['cover', 'executive_summary', 'key_metrics', 'charts', 'roadmap', 'ai_analysis'])
    expect(snap.metrics.find((m) => m.label === 'Roadmap steps')?.value).toBe(10)
    expect(snap.charts[0]!.data.map((d) => d.value)).toEqual([1, 2, 6, 1, 0])
    expect(snap.executiveSummary).toMatch(/behind on the Now stage/)
    expect(snapshot('en', false).executiveSummary).toMatch(/10 roadmap steps/)
  })

  it('renders the PDF with the node diagram, step details and AI analysis', async () => {
    const buffer = await renderToBuffer(doc(snapshot('en')))
    expect(buffer.length).toBeGreaterThan(5_000)
    // cover, summary, landscape diagram, details/analysis, closing
    expect(buffer.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(5)
  }, 60_000)

  it('renders without an AI analysis', async () => {
    const buffer = await renderToBuffer(doc(snapshot('en', false)))
    expect(buffer.length).toBeGreaterThan(5_000)
  }, 60_000)

  it('the customize prompt understands roadmap requests', () => {
    expect(customizeReportFromPrompt('personal', 'roadmap report for my app').config.typeId).toBe('roadmap')
    expect(customizeReportFromPrompt('workspace', 'show milestone status').config.typeId).toBe('roadmap')
  })
})
