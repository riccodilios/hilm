import { describe, expect, it } from 'vitest'
import {
  analysisResponseSchema,
  buildAnalysisTranscript,
  extractJsonObject,
  normalizeSpeakerLabel,
  parseClockOrSeconds,
  sanitizeAnalysis,
  stitchChunkSegments,
  transcriptionResponseSchema,
  type AnalysisLine,
  type RosterSpeaker,
} from './meeting-core'

const roster: RosterSpeaker[] = [
  { id: 's1', label: 'Speaker 1', description: null, display_name: 'Rakan' },
  { id: 's2', label: 'Speaker 2', description: null, display_name: null },
]

describe('transcription parsing and stitching', () => {
  it('accepts clock strings and numbers for timestamps', () => {
    expect(parseClockOrSeconds('01:05')).toBe(65)
    expect(parseClockOrSeconds('1:00:02')).toBe(3602)
    expect(parseClockOrSeconds('12.5')).toBe(12.5)
    expect(parseClockOrSeconds('abc')).toBeNull()
    const parsed = transcriptionResponseSchema.parse({
      segments: [{ speaker: 'Speaker 1', start: '00:03', end: 5, text: 'hi' }],
    })
    expect(parsed.segments[0]!.start).toBe(3)
  })

  it('offsets chunk-relative times to meeting-absolute times with stable ordinals', () => {
    const response = transcriptionResponseSchema.parse({
      segments: [
        { speaker: 'Speaker 1', start: 0, end: 4.2, text: 'مرحبا بالجميع', language: 'ar' },
        { speaker: 'speaker 2', start: 4.5, end: 9, text: '  Let us review the   API ', language: 'en' },
        { speaker: 'Speaker 2', start: 10, end: 11, text: '   ' },
      ],
    })
    const out = stitchChunkSegments({ response, chunkIdx: 3, offsetMs: 270_000, durationMs: 90_000, roster })
    expect(out).toEqual([
      { speakerLabel: 'Speaker 1', start_ms: 270_000, end_ms: 274_200, text: 'مرحبا بالجميع', language: 'ar', ordinal: 30_000 },
      { speakerLabel: 'Speaker 2', start_ms: 274_500, end_ms: 279_000, text: 'Let us review the API', language: 'en', ordinal: 30_001 },
    ])
  })

  it('clamps out-of-range and non-monotonic timestamps into the chunk', () => {
    const response = transcriptionResponseSchema.parse({
      segments: [
        { speaker: 'Speaker 1', start: 50, end: 200, text: 'a' },
        { speaker: 'Speaker 1', start: 20, end: 10, text: 'b' },
      ],
    })
    const out = stitchChunkSegments({ response, chunkIdx: 0, offsetMs: 0, durationMs: 60_000, roster })
    expect(out[0]).toMatchObject({ start_ms: 50_000, end_ms: 60_000 })
    expect(out[1]!.start_ms).toBeGreaterThanOrEqual(out[0]!.start_ms)
    expect(out[1]!.end_ms).toBeGreaterThanOrEqual(out[1]!.start_ms)
  })

  it('maps renamed speakers back to their stable label', () => {
    expect(normalizeSpeakerLabel('Rakan', roster)).toBe('Speaker 1')
    expect(normalizeSpeakerLabel('SPEAKER 7', roster)).toBe('Speaker 7')
    expect(normalizeSpeakerLabel('Unknown', roster)).toBe('Speaker 1')
  })

  it('extracts JSON from fenced or chatty model output', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJsonObject('Sure! {"segments":[]} hope that helps')).toEqual({ segments: [] })
    expect(extractJsonObject('no json')).toBeNull()
  })
})

describe('sanitizeAnalysis', () => {
  const lines: AnalysisLine[] = [
    { ref: 1, segmentId: 'seg-a', speakerLabel: 'Speaker 1', startMs: 0, text: 'We will ship on Thursday.' },
    { ref: 2, segmentId: 'seg-b', speakerLabel: 'Speaker 2', startMs: 5000, text: "I'll write the release notes." },
  ]

  const run = (raw: unknown) =>
    sanitizeAnalysis(analysisResponseSchema.parse(raw), {
      lines,
      rosterLabels: ['Speaker 1', 'Speaker 2'],
      displayNames: { 'Speaker 1': 'Rakan' },
    })

  it('maps source refs to segment ids and drops invented refs', () => {
    const result = run({
      summary: ' Release planning. ',
      key_points: ['Ship Thursday', ' '],
      decisions: [{ text: 'Ship on Thursday', certainty: 'confirmed', sources: [1, '#99'] }],
      action_items: [],
    })
    expect(result.summary).toBe('Release planning.')
    expect(result.key_points).toEqual(['Ship Thursday'])
    expect(result.decisions).toEqual([{ text: 'Ship on Thursday', certainty: 'confirmed', source_segment_ids: ['seg-a'] }])
  })

  it('downgrades unsupported decisions and action items', () => {
    const result = run({
      summary: '',
      decisions: [{ text: 'Hire a designer', certainty: 'confirmed', sources: [] }],
      action_items: [{ title: 'Hire designer', certainty: 'confirmed', owner: 'Speaker 2', owner_certainty: 'confirmed' }],
    })
    expect(result.decisions[0]!.certainty).toBe('uncertain')
    expect(result.action_items[0]).toMatchObject({ certainty: 'possible', owner_certainty: 'uncertain' })
  })

  it('never invents owners outside the speaker roster', () => {
    const result = run({
      summary: '',
      action_items: [
        { title: 'A', certainty: 'confirmed', owner: 'Sarah', owner_certainty: 'confirmed', sources: [2] },
        { title: 'B', certainty: 'confirmed', owner: 'Rakan', owner_certainty: 'confirmed', sources: [1] },
        { title: 'C', certainty: 'confirmed', owner: 'speaker 2', owner_certainty: 'confirmed', sources: [2] },
        { title: 'D', certainty: 'confirmed', owner: 'Speaker 9', sources: [2] },
      ],
    })
    expect(result.action_items.map((item) => [item.title, item.ownerLabel, item.owner_certainty])).toEqual([
      ['A', null, 'none'],
      ['B', 'Speaker 1', 'confirmed'],
      ['C', 'Speaker 2', 'confirmed'],
      ['D', null, 'none'],
    ])
  })

  it('keeps due dates only when a deadline was stated and the date is valid', () => {
    const result = run({
      summary: '',
      action_items: [
        { title: 'With deadline', certainty: 'confirmed', due_text: 'by Thursday', due_date: '2026-10-01', sources: [1] },
        { title: 'Invented date', certainty: 'confirmed', due_text: null, due_date: '2026-10-01', sources: [1] },
        { title: 'Bad date', certainty: 'confirmed', due_text: 'soon', due_date: '2026-02-30', sources: [1] },
      ],
    })
    expect(result.action_items.map((item) => [item.due_text, item.due_date])).toEqual([
      ['by Thursday', '2026-10-01'],
      [null, null],
      ['soon', null],
    ])
  })

  it('dedupes action items by title and tolerates malformed fields', () => {
    const result = run({
      summary: 42,
      decisions: 'nope',
      action_items: [
        { title: 'Write notes', certainty: 'weird', priority: 'critical', sources: [2] },
        { title: 'write NOTES', certainty: 'confirmed', sources: [2] },
      ],
    })
    expect(result.summary).toBe('')
    expect(result.decisions).toEqual([])
    expect(result.action_items).toHaveLength(1)
    expect(result.action_items[0]).toMatchObject({ certainty: 'possible', priority: null })
  })

  it('formats the analysis transcript with refs and respects the size cap', () => {
    const text = buildAnalysisTranscript(lines)
    expect(text).toBe("[#1] (00:00) Speaker 1: We will ship on Thursday.\n[#2] (00:05) Speaker 2: I'll write the release notes.")
    expect(buildAnalysisTranscript(lines, 60).split('\n')).toHaveLength(1)
  })
})
