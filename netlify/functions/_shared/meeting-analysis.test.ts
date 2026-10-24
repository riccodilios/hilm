import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analysisStepCallsModel,
  executeAnalysisStep,
  groupPartialsForMerge,
  planAnalysis,
  runMeetingAnalysis,
  type AnalysisProgress,
} from './meeting-analysis'
import type { AnalysisLine } from './meeting-core'

const { runAiCompletion } = vi.hoisted(() => ({ runAiCompletion: vi.fn() }))
vi.mock('./ai-gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai-gateway')>()),
  runAiCompletion,
}))

const reply = (content: unknown) => ({
  ok: true,
  content: JSON.stringify(content),
  usage: null,
  tokens: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.0001 },
  model: 'google/gemini-2.5-flash',
  attempts: 1,
  truncated: false,
})

/** `count` lines of ~`size` chars; Arabic, English and mixed lines alternate. */
function transcript(count: number, size = 1_000): AnalysisLine[] {
  const samples = ['Budget review for the launch', 'نراجع الميزانية قبل الإطلاق', 'خلينا نراجع the dashboard اليوم']
  return Array.from({ length: count }, (_, i) => ({
    ref: i + 1,
    segmentId: `seg-${i + 1}`,
    speakerLabel: `Speaker ${(i % 3) + 1}`,
    startMs: i * 60_000,
    text: `${samples[i % 3]} — line ${i + 1} ${'x'.repeat(Math.max(0, size - 60))}`,
  }))
}

const input = (lines: AnalysisLine[]) => ({
  apiKey: 'test',
  title: 'Quarterly planning',
  meetingDate: '2026-10-24',
  projectName: null,
  roster: [
    { label: 'Speaker 1', display_name: null },
    { label: 'Speaker 2', display_name: null },
    { label: 'Speaker 3', display_name: null },
  ],
  locale: 'en' as const,
  lines,
  model: 'google/gemini-2.5-flash',
})

const refsIn = (text: string) => [...text.matchAll(/#(\d+) /g)].map((match) => Number(match[1]))

/** Fake model: every chunk reports one decision citing its first and last line. */
function fakeModel() {
  runAiCompletion.mockImplementation(async (call: { messages: Array<{ content: string }> }) => {
    const user = call.messages[1]!.content
    if (user.startsWith('Partials')) {
      const partials = JSON.parse(user.slice(user.indexOf('\n') + 1)) as Array<{
        summary: string
        decisions: unknown[]
        key_points: string[]
      }>
      return reply({
        summary: partials.map((partial) => partial.summary).join(' | '),
        key_points: partials.flatMap((partial) => partial.key_points).slice(0, 30),
        decisions: partials.flatMap((partial) => partial.decisions).slice(0, 40),
        action_items: [],
      })
    }
    const refs = refsIn(user)
    const first = refs[0]!
    const last = refs[refs.length - 1]!
    return reply({
      summary: `lines ${first}-${last}`,
      key_points: [`covers ${first}-${last}`],
      decisions: [{ text: `Decision from line ${first}`, certainty: 'confirmed', sources: [first] }],
      action_items: [],
    })
  })
}

beforeEach(() => {
  runAiCompletion.mockReset()
})

describe('planAnalysis', () => {
  it('uses one direct call for short transcripts', () => {
    expect(planAnalysis(transcript(10), null).step).toEqual({ kind: 'direct', key: 'direct' })
  })

  it('splits long transcripts into chunk steps and resumes from stored progress', () => {
    const lines = transcript(120)
    const first = planAnalysis(lines, null)
    expect(first.step).toMatchObject({ kind: 'chunk', index: 0 })
    expect(first.windows.length).toBeGreaterThan(2)
    first.progress!.levels[0]![0] = { summary: 'done', key_points: [], decisions: [], action_items: [] }
    expect(planAnalysis(lines, first.progress).step).toMatchObject({ kind: 'chunk', index: 1 })
  })

  it('discards progress that belongs to a different transcript', () => {
    const progress = planAnalysis(transcript(120), null).progress!
    progress.levels[0]![0] = { summary: 'old', key_points: [], decisions: [], action_items: [] }
    expect(planAnalysis(transcript(121), progress).step).toMatchObject({ kind: 'chunk', index: 0 })
  })

  it('groups partials into bounded merges, never leaving a lone trailing partial', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ summary: 'p'.repeat(400) + i, key_points: [], decisions: [], action_items: [] }))
    const groups = groupPartialsForMerge(items, 1_000)
    expect(groups.flat()).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(groups.every((group) => group.length >= 2)).toBe(true)
  })
})

describe('long-meeting analysis', () => {
  it('analyses beginning, middle and end of a 200-line transcript without truncation', async () => {
    fakeModel()
    const lines = transcript(200)
    const result = await runMeetingAnalysis(input(lines))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strategy).toBe('hierarchical')
    // Every transcript line was sent to exactly one chunk call.
    const chunkCalls = runAiCompletion.mock.calls.filter(([call]) => call.feature === 'meeting_chunk_summary')
    const sentRefs = chunkCalls.flatMap(([call]) => refsIn(call.messages[1].content))
    expect(sentRefs).toEqual(lines.map((line) => line.ref))
    // The final analysis cites the first, a middle and the last part of the meeting.
    const cited = result.analysis.decisions.flatMap((decision) => decision.source_segment_ids)
    expect(cited).toContain('seg-1')
    expect(cited.some((id) => Number(id.slice(4)) > 80 && Number(id.slice(4)) < 120)).toBe(true)
    expect(cited.some((id) => Number(id.slice(4)) > 180)).toBe(true)
    expect(result.analysis.summary).toContain('lines 1-')
  })

  it('merges in levels when the partials exceed one merge call', async () => {
    fakeModel()
    const lines = transcript(200)
    const sizes = { directMaxChars: 48_000, chunkChars: 12_000, mergeMaxChars: 900 }
    let progress: AnalysisProgress | null = null
    const steps: string[] = []
    let modelSteps = 0
    for (let guard = 0; guard < 100; guard += 1) {
      const planned = planAnalysis(lines, progress, sizes)
      steps.push(planned.step.key)
      if (analysisStepCallsModel(planned.step, planned.progress)) modelSteps += 1
      const result = await executeAnalysisStep(input(lines), planned)
      expect(result.ok).toBe(true)
      if (!result.ok || result.done) break
      progress = result.progress
    }
    expect(steps.some((key) => key.startsWith('m0g'))).toBe(true)
    expect(steps.at(-1)).toMatch(/^f[1-9]/)
    // At most one model call per step: no step re-sends the whole meeting.
    expect(runAiCompletion).toHaveBeenCalledTimes(modelSteps)
  })

  it('re-asks once for unreadable JSON, then reports the failure instead of skipping the part', async () => {
    runAiCompletion.mockResolvedValue({ ...reply({}), content: 'not json' })
    const lines = transcript(120)
    const planned = planAnalysis(lines, null)
    const result = await executeAnalysisStep(input(lines), planned)
    expect(result).toMatchObject({ ok: false, code: 'parse_error' })
    expect(runAiCompletion).toHaveBeenCalledTimes(2)
  })

  it('keeps Arabic, English and mixed text unchanged in what the model reads', async () => {
    fakeModel()
    const lines = transcript(6, 120)
    await runMeetingAnalysis(input(lines))
    const sent = runAiCompletion.mock.calls[0]![0].messages[1].content as string
    expect(sent).toContain('نراجع الميزانية قبل الإطلاق')
    expect(sent).toContain('خلينا نراجع the dashboard اليوم')
    expect(sent).toContain('Budget review for the launch')
  })
})
