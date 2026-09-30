import { describe, expect, it } from 'vitest'
import {
  MEETING_AUTO_ATTEMPTS,
  analysisResponseSchema,
  buildAnalysisPrompt,
  buildAnalysisTranscript,
  buildTranscriptionPrompt,
  extractJsonObject,
  friendlyMeetingError,
  inferSpokenLanguages,
  normalizeLanguageCode,
  normalizeSpeakerLabel,
  parseClockOrSeconds,
  resolveSegmentLanguageMeta,
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

describe('meeting error UX', () => {
  it('caps auto-attempts so flaky STT cannot multiply spend', () => {
    expect(MEETING_AUTO_ATTEMPTS).toBe(3)
  })

  it('surfaces specific copy for save failures instead of a bare Processing failed', () => {
    expect(friendlyMeetingError('save_error')).toMatch(/audio is safe/i)
    expect(friendlyMeetingError('save_error')).not.toBe('Processing failed.')
    expect(friendlyMeetingError('provider_error')).toMatch(/AI service/i)
  })
})

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
      {
        speakerLabel: 'Speaker 1',
        start_ms: 270_000,
        end_ms: 274_200,
        text: 'مرحبا بالجميع',
        language: 'ar',
        languages: ['ar'],
        confidence: null,
        ordinal: 30_000,
      },
      {
        speakerLabel: 'Speaker 2',
        start_ms: 274_500,
        end_ms: 279_000,
        text: 'Let us review the API',
        language: 'en',
        languages: ['en'],
        confidence: null,
        ordinal: 30_001,
      },
    ])
  })

  it('normalizes dialect labels and BCP-47 codes without inventing language', () => {
    expect(normalizeLanguageCode('ar-SA')).toBe('ar-SA')
    expect(normalizeLanguageCode('Saudi Arabic')).toBe('ar-SA')
    expect(normalizeLanguageCode('lebanese')).toBe('ar-LB')
    expect(normalizeLanguageCode('Egyptian Arabic')).toBe('ar-EG')
    expect(normalizeLanguageCode('gulf')).toBe('ar-AE')
    expect(normalizeLanguageCode('en')).toBe('en')
    expect(normalizeLanguageCode('mixed')).toBe('mixed')
    expect(normalizeLanguageCode('')).toBeNull()
    expect(normalizeLanguageCode(null)).toBeNull()
  })

  it('preserves mixed Arabic+English technical speech and marks mixed language metadata', () => {
    const response = transcriptionResponseSchema.parse({
      segments: [
        {
          speaker: 'Speaker 1',
          start: 0,
          end: 5,
          text: 'لازم نخلص الـ backend اليوم وبعدين نعمل deployment على production.',
          language: 'Saudi Arabic',
          languages: ['ar', 'en'],
          confidence: 0.92,
        },
        {
          speaker: 'Speaker 2',
          start: 5,
          end: 9,
          text: 'The frontend is ready بس الـ API لسه ما خلص.',
          language: 'ar-LB',
        },
        {
          speaker: 'Speaker 1',
          start: 9,
          end: 12,
          text: 'We need to finish the API integration before Thursday.',
          language: 'en',
        },
        {
          speaker: 'Speaker 1',
          start: 12,
          end: 16,
          text: 'الشركة تستخدم Visma في المحاسبة.',
          language: 'ar',
          languages: ['ar', 'en'],
        },
      ],
    })
    const out = stitchChunkSegments({ response, chunkIdx: 0, offsetMs: 0, durationMs: 60_000, roster })
    expect(out[0]).toMatchObject({
      language: 'mixed',
      languages: ['ar', 'en'],
      confidence: 0.92,
      text: 'لازم نخلص الـ backend اليوم وبعدين نعمل deployment على production.',
    })
    expect(out[1]).toMatchObject({ language: 'mixed', languages: expect.arrayContaining(['ar', 'en']) })
    expect(out[2]).toMatchObject({ language: 'en', languages: ['en'] })
    expect(out[3]!.text).toContain('Visma')
    expect(out[3]).toMatchObject({ language: 'mixed' })
    expect(out[0]!.text).toContain('backend')
    expect(out[0]!.text).toContain('deployment')
    expect(out[1]!.text).toContain('API')
  })

  it('infers spoken languages from script without rewriting text', () => {
    expect(inferSpokenLanguages('خلينا نراجع the API integration')).toEqual(['ar', 'en'])
    expect(inferSpokenLanguages('Let us review the API architecture.')).toEqual(['en'])
    expect(inferSpokenLanguages('خلينا نراجع الموضوع مرة ثانية.')).toEqual(['ar'])
    expect(
      resolveSegmentLanguageMeta({
        language: 'ar',
        text: 'نحتاج نعمل deployment على production',
      }),
    ).toEqual({ language: 'mixed', languages: ['ar', 'en'] })
  })

  it('transcription prompt forbids meeting-level language lock, translation, and transliteration', () => {
    const prompt = buildTranscriptionPrompt({
      roster,
      previousLines: [{ label: 'Speaker 1', text: 'السلام عليكم' }],
      chunkIdx: 0,
      vocabulary: ['Visma', 'Milkman'],
    })
    expect(prompt).toMatch(/language-agnostic/i)
    expect(prompt).toMatch(/NO MEETING-LEVEL LANGUAGE LOCK/i)
    expect(prompt).toMatch(/THIS IS TRANSCRIPTION, NOT TRANSLATION/i)
    expect(prompt).toMatch(/Do NOT transliterate English into Arabic/i)
    expect(prompt).toMatch(/Visma/)
    expect(prompt).toMatch(/Milkman/)
    expect(prompt).toMatch(/speaker continuity ONLY/i)
    expect(prompt).toMatch(/code-switching|CODE-SWITCHING/i)
    expect(prompt).toMatch(/UI language.*MUST NOT decide/i)
    expect(prompt).not.toMatch(/languageHint/)
  })

  it('analysis prompt understands Arabic dates and multilingual actions', () => {
    const prompt = buildAnalysisPrompt({
      title: 'تخطيط الأسبوع',
      meetingDate: '2026-09-14',
      projectName: 'Hilm',
      roster: [{ label: 'Speaker 1', display_name: 'محمد' }],
      locale: 'ar',
      timeZone: 'Asia/Riyadh',
    })
    expect(prompt).toMatch(/بكرا/)
    expect(prompt).toMatch(/Asia\/Riyadh/)
    expect(prompt).toMatch(/multilingual/i)
    expect(prompt).toMatch(/Do NOT translate the whole meeting into English/i)
    expect(prompt).toMatch(/API integration/)
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
        { title: 'خلص الاختبار', certainty: 'confirmed', due_text: 'بكرا', due_date: '2026-09-15', sources: [1] },
      ],
    })
    expect(result.action_items.map((item) => [item.due_text, item.due_date])).toEqual([
      ['by Thursday', '2026-10-01'],
      [null, null],
      ['soon', null],
      ['بكرا', '2026-09-15'],
    ])
  })

  it('keeps Arabic action titles and renamed Arabic speaker owners', () => {
    const result = sanitizeAnalysis(
      analysisResponseSchema.parse({
        language: 'ar-SA',
        summary: 'اتفقنا نخلص الـ API.',
        action_items: [
          {
            title: 'يخلص الـ testing',
            certainty: 'confirmed',
            owner: 'محمد',
            owner_certainty: 'confirmed',
            due_text: 'بكرا',
            due_date: '2026-09-15',
            sources: [2],
          },
        ],
      }),
      {
        lines,
        rosterLabels: ['Speaker 1', 'Speaker 2'],
        displayNames: { 'Speaker 1': 'محمد' },
      },
    )
    expect(result.language).toBe('ar-SA')
    expect(result.action_items[0]).toMatchObject({
      title: 'يخلص الـ testing',
      ownerLabel: 'Speaker 1',
      due_text: 'بكرا',
      due_date: '2026-09-15',
    })
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

describe('true multilingual meeting scenarios', () => {
  function stitch(segments: Array<Record<string, unknown>>) {
    const response = transcriptionResponseSchema.parse({ segments })
    return stitchChunkSegments({ response, chunkIdx: 0, offsetMs: 0, durationMs: 120_000, roster })
  }

  it('TEST 1 — Arabic meeting start does not force later English into Arabic', () => {
    const out = stitch([
      { speaker: 'Speaker 1', start: 0, end: 4, text: 'السلام عليكم، خلونا نبدأ الاجتماع.', language: 'ar' },
      {
        speaker: 'Speaker 2',
        start: 5,
        end: 10,
        text: "Let's discuss the new API architecture.",
        language: 'en',
      },
    ])
    expect(out[1]!.text).toBe("Let's discuss the new API architecture.")
    expect(out[1]!.language).toBe('en')
    expect(out[1]!.text).not.toMatch(/[\u0600-\u06FF]/)
  })

  it('TEST 2 — English meeting start does not force later Arabic into English', () => {
    const out = stitch([
      { speaker: 'Speaker 1', start: 0, end: 4, text: 'Today we will review the roadmap.', language: 'en' },
      {
        speaker: 'Speaker 2',
        start: 5,
        end: 10,
        text: 'خلينا نراجع الموضوع مرة ثانية.',
        language: 'ar',
      },
    ])
    expect(out[1]!.text).toBe('خلينا نراجع الموضوع مرة ثانية.')
    expect(out[1]!.language).toBe('ar')
    expect(out[1]!.text).not.toMatch(/review|topic/i)
  })

  it('TEST 3 — Arabic + English in one sentence stays mixed', () => {
    const text = 'خلينا نراجع the API integration وبعدها نرسل التقرير.'
    const out = stitch([{ speaker: 'Speaker 1', start: 0, end: 6, text, language: 'mixed', languages: ['ar', 'en'] }])
    expect(out[0]!.text).toBe(text)
    expect(out[0]).toMatchObject({ language: 'mixed', languages: ['ar', 'en'] })
  })

  it('TEST 4 — English company name inside Arabic is not transliterated', () => {
    const text = 'الشركة تستخدم Visma في المحاسبة.'
    const out = stitch([{ speaker: 'Speaker 1', start: 0, end: 5, text, language: 'ar', languages: ['ar', 'en'] }])
    expect(out[0]!.text).toContain('Visma')
    expect(out[0]!.text).not.toContain('فيجم')
  })

  it('TEST 5 — English proper noun Milkman is preserved (no entity hallucination)', () => {
    const out = stitch([{ speaker: 'Speaker 1', start: 0, end: 2, text: 'Milkman', language: 'en' }])
    expect(out[0]!.text).toBe('Milkman')
    expect(out[0]!.text).not.toMatch(/دبل كليك|شركة/)
  })

  it('TEST 6 — multiple speakers keep independent languages', () => {
    const out = stitch([
      { speaker: 'Speaker 1', start: 0, end: 3, text: 'السلام عليكم، خلونا نبدأ الاجتماع.', language: 'ar' },
      {
        speaker: 'Speaker 2',
        start: 3,
        end: 8,
        text: 'Sure, I think we should start with the API architecture.',
        language: 'en',
      },
      {
        speaker: 'Speaker 3',
        start: 8,
        end: 13,
        text: 'أنا أتفق، but we need to check the database first.',
        language: 'mixed',
        languages: ['ar', 'en'],
      },
    ])
    expect(out[0]!.language).toBe('ar')
    expect(out[1]!.language).toBe('en')
    expect(out[2]).toMatchObject({ language: 'mixed', languages: expect.arrayContaining(['ar', 'en']) })
    expect(out[2]!.text).toContain('database')
  })

  it('TEST 7 — one speaker switching languages mid-turn', () => {
    const text = 'Okay خلينا نبدأ. أول شيء we need to check the database.'
    const out = stitch([{ speaker: 'Speaker 1', start: 0, end: 8, text, language: 'mixed' }])
    expect(out[0]!.text).toBe(text)
    expect(out[0]!.language).toBe('mixed')
  })

  it('TEST 8 — technical discussion preserves English terms inside Arabic', () => {
    const text = 'نحتاج نعمل deployment على production وبعدها نراجع the database migration.'
    const out = stitch([{ speaker: 'Speaker 1', start: 0, end: 8, text }])
    expect(out[0]!.text).toBe(text)
    expect(out[0]!.text).toContain('deployment')
    expect(out[0]!.text).toContain('production')
    expect(out[0]!.text).toContain('database migration')
    expect(out[0]!.language).toBe('mixed')
  })
})
