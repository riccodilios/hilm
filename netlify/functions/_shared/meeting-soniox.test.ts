import { describe, expect, it } from 'vitest'
import {
  buildSonioxContext,
  buildWavHeader,
  estimateSonioxUsage,
  parseWavPcm,
  pcmDurationMs,
  planSonioxWindows,
  reconcileWindowSpeakers,
  sameFormat,
  SONIOX_MAX_AUDIO_MS,
  SONIOX_WINDOW_MAX_MS,
  sonioxReference,
  sonioxTokensToLines,
  sonioxTranscriptProblem,
  type SonioxAudioPart,
} from './meeting-soniox'
import type { SonioxToken } from './soniox'

const parts = [
  { id: 'seg-0', idx: 0, offset_ms: 0, duration_ms: 90_000 },
  { id: 'seg-1', idx: 1, offset_ms: 90_000, duration_ms: 90_000 },
]

const tok = (text: string, start: number, speaker: string, language = 'en'): SonioxToken => ({
  text,
  start_ms: start,
  end_ms: start + 300,
  speaker,
  language,
})

describe('buildSonioxContext', () => {
  it('instructs verbatim Arabic/English without translation and carries terms', () => {
    const context = buildSonioxContext({ title: 'Q3 review', projectName: 'Hilm', vocabulary: ['OpenRouter', 'hilm', 'Netlify'] })
    const instructions = context.general?.find((entry) => entry.key === 'instructions')?.value ?? ''
    expect(instructions).toMatch(/Do not translate/)
    expect(context.general).toContainEqual({ key: 'project', value: 'Hilm' })
    expect(context.general).toContainEqual({ key: 'topic', value: 'Q3 review' })
    // Case-insensitive de-duplication keeps the first spelling.
    expect(context.terms).toEqual(['Hilm', 'OpenRouter', 'Netlify'])
  })

  it('caps the context size', () => {
    const vocabulary = Array.from({ length: 500 }, (_, i) => `Term number ${i} with padding`)
    const context = buildSonioxContext({ vocabulary })
    expect(JSON.stringify(context).length).toBeLessThan(10_000)
  })
})

describe('sonioxTokensToLines', () => {
  it('keeps Soniox speaker ids exactly and maps times onto recorded parts', () => {
    const lines = sonioxTokensToLines(
      [
        tok('Hello', 1_000, '1'),
        tok(' team', 1_400, '1'),
        tok('مرحبا', 2_000, '2', 'ar'),
        tok(' بالجميع', 2_400, '2', 'ar'),
        tok('Next', 95_000, '3'),
      ],
      parts,
    )
    expect(lines.map((line) => [line.speakerLabel, line.text, line.audioSegmentId])).toEqual([
      ['Speaker 1', 'Hello team', 'seg-0'],
      ['Speaker 2', 'مرحبا بالجميع', 'seg-0'],
      ['Speaker 3', 'Next', 'seg-1'],
    ])
    expect(lines[1]?.language).toBe('ar')
    expect(lines[2]).toMatchObject({ start_ms: 95_000, ordinal: 10_000 })
    expect(lines[0]?.ordinal).toBe(0)
    expect(lines[1]?.ordinal).toBe(1)
  })

  it('never merges or renumbers distinct Soniox speakers', () => {
    const lines = sonioxTokensToLines([tok('a', 0, '4'), tok('b', 500, '2'), tok('c', 1_000, '4')], parts)
    expect(lines.map((line) => line.speakerLabel)).toEqual(['Speaker 4', 'Speaker 2', 'Speaker 4'])
  })

  it('preserves mixed Arabic/English text untranslated', () => {
    const lines = sonioxTokensToLines(
      [tok('خلينا', 0, '1', 'ar'), tok(' نراجع', 300, '1', 'ar'), tok(' the', 600, '1'), tok(' dashboard', 900, '1')],
      parts,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]?.text).toBe('خلينا نراجع the dashboard')
    expect(lines[0]?.languages).toEqual(expect.arrayContaining(['ar', 'en']))
  })

  it('breaks lines on long pauses and skips translation tokens', () => {
    const lines = sonioxTokensToLines(
      [tok('One', 0, '1'), { ...tok(' uno', 200, '1'), translation_status: 'translation' }, tok(' Two', 10_000, '1')],
      parts,
    )
    expect(lines.map((line) => line.text)).toEqual(['One', 'Two'])
  })
})

describe('sonioxTranscriptProblem', () => {
  it('flags empty and structurally inconsistent transcripts', () => {
    expect(sonioxTranscriptProblem({ text: '', tokens: [] }, 120_000)).toBe('empty_transcript')
    expect(sonioxTranscriptProblem({ text: '', tokens: [] }, 10_000)).toBeNull()
    expect(sonioxTranscriptProblem({ text: 'x', tokens: [tok('x', 500_000, '1')] }, 120_000)).toBe('timeline_mismatch')
    expect(sonioxTranscriptProblem({ text: 'x', tokens: [tok('x', 1_000, '1')] }, 120_000)).toBeNull()
  })
})

describe('estimateSonioxUsage', () => {
  it('prices with Soniox rates (about $0.10 per audio hour)', () => {
    const usage = estimateSonioxUsage({ audioMs: 3_600_000, outputText: '', contextChars: 0 })
    expect(usage.audioTokens).toBe(30_000)
    expect(usage.costUsd).toBeCloseTo(0.045, 5)
    const withText = estimateSonioxUsage({ audioMs: 3_600_000, outputText: 'x'.repeat(50_000), contextChars: 1_000 })
    expect(withText.costUsd).toBeGreaterThan(usage.costUsd)
    expect(withText.costUsd).toBeLessThan(0.2)
  })
})

describe('WAV joining helpers', () => {
  it('round-trips a PCM header and computes duration', () => {
    const format = { sampleRate: 16_000, channels: 1, bitsPerSample: 16 }
    const pcm = new Uint8Array(32_000)
    const header = buildWavHeader(format, pcm.length)
    const wav = new Uint8Array(header.length + pcm.length)
    wav.set(header)
    wav.set(pcm, header.length)
    const parsed = parseWavPcm(wav)
    expect(parsed?.format).toEqual(format)
    expect(parsed?.data.byteLength).toBe(32_000)
    expect(pcmDurationMs(format, 32_000)).toBe(1_000)
    expect(sameFormat(format, { ...format, sampleRate: 48_000 })).toBe(false)
  })

  it('rejects non-WAV input', () => {
    expect(parseWavPcm(new Uint8Array(100))).toBeNull()
  })

  it('builds a stable per-meeting reference', () => {
    expect(sonioxReference('workspace', 'abc')).toBe('hilm:workspace:abc')
  })
})

/** Parts of a recording laid end to end (the recorder cuts ~90 s parts). */
function recording(totalMs: number, partMs = 90_000): SonioxAudioPart[] {
  const out: SonioxAudioPart[] = []
  for (let offset = 0, idx = 0; offset < totalMs; offset += partMs, idx += 1) {
    out.push({ id: `seg-${idx}`, idx, offset_ms: offset, duration_ms: Math.min(partMs, totalMs - offset) })
  }
  return out
}

const MIN = 60_000

describe('planSonioxWindows (long meetings)', () => {
  it.each([
    ['59 minutes', 59 * MIN, 1],
    ['the 1-hour boundary', 61 * MIN, 1],
    ['75 minutes', 75 * MIN, 1],
    ['the reported 1:15:57 meeting', 75 * MIN + 57_000, 1],
    ['200 minutes', 200 * MIN, 2],
    ['8 hours', 480 * MIN, 5],
  ])('covers %s with the expected number of Soniox jobs', (_label, totalMs, expected) => {
    const parts = recording(totalMs)
    const windows = planSonioxWindows(parts)
    expect(windows).toHaveLength(expected)
    // Every part is sent, the last part included, and no job exceeds Soniox's file limit.
    expect(new Set(windows.flatMap((window) => window.parts.map((part) => part.idx))).size).toBe(parts.length)
    expect(windows.at(-1)!.parts.at(-1)!.idx).toBe(parts.at(-1)!.idx)
    for (const window of windows) expect(window.audioMs).toBeLessThanOrEqual(Math.min(SONIOX_MAX_AUDIO_MS, SONIOX_WINDOW_MAX_MS + 90_000))
  })

  it('shares one part between consecutive windows and splits ownership in its middle', () => {
    const windows = planSonioxWindows(recording(200 * MIN))
    const [first, second] = windows
    expect(second!.parts[0]!.idx).toBe(first!.parts.at(-1)!.idx)
    const shared = second!.parts[0]!
    expect(first!.keepToMs).toBe(shared.offset_ms + shared.duration_ms / 2)
    expect(second!.keepFromMs).toBe(first!.keepToMs)
    expect(second!.overlapFromMs).toBe(shared.offset_ms)
    expect(first!.keepFromMs).toBe(0)
    expect(second!.keepToMs).toBeNull()
  })
})

describe('window boundaries', () => {
  const windows = planSonioxWindows(recording(200 * MIN))
  const [first, second] = windows
  const boundary = second!.keepFromMs
  const secondStart = second!.parts[0]!.offset_ms
  // Same overlap speech heard by both jobs, plus one word right after the boundary.
  const firstTokens = [
    tok('Opening', 1_000, '1'),
    tok(' overlap words', boundary - 20_000, '1'),
    tok(' bridge', boundary + 1_000, '1'),
  ]
  const secondTokens = [
    tok('overlap words', boundary - 20_000 - secondStart, '2'),
    tok(' bridge', boundary + 1_000 - secondStart, '2'),
    tok('Closing', 200 * MIN - 5_000 - secondStart, '1'),
  ]

  it('keeps each word exactly once across the boundary, in order', () => {
    const a = sonioxTokensToLines(firstTokens, first!.parts, { keepToMs: first!.keepToMs })
    const b = sonioxTokensToLines(secondTokens, second!.parts, {
      keepFromMs: second!.keepFromMs,
      keepToMs: second!.keepToMs,
      sharedFirstPart: true,
    })
    const all = [...a, ...b].sort((x, y) => x.ordinal - y.ordinal)
    const text = all.map((line) => line.text).join(' ')
    expect(text.match(/overlap words/g)).toHaveLength(1)
    expect(text.match(/bridge/g)).toHaveLength(1)
    expect(all.map((line) => line.start_ms)).toEqual([...all.map((line) => line.start_ms)].sort((x, y) => x - y))
    expect(all.at(-1)!.text).toBe('Closing')
    expect(all.at(-1)!.start_ms).toBe(200 * MIN - 5_000)
    // Later-window lines inside the shared part sort after the earlier window's lines there.
    const shared = second!.parts[0]!
    const inShared = all.filter((line) => line.audioSegmentId === shared.id)
    expect(inShared.map((line) => line.ordinal)).toEqual([...inShared.map((line) => line.ordinal)].sort((x, y) => x - y))
  })

  it('links a later-window speaker to the earlier label only on clear overlap evidence', () => {
    const overlapTokens = Array.from({ length: 10 }, (_, i) => tok(` w${i}`, boundary - 40_000 + i * 3_000 - secondStart, '2'))
    const previousLines = [{ start_ms: boundary - 45_000, end_ms: boundary - 5_000, speakerLabel: 'Speaker 1' }]
    const { label, matches } = reconcileWindowSpeakers({
      tokens: [...overlapTokens, tok('new voice', 9_000_000 - secondStart, '1')],
      parts: second!.parts,
      overlapFromMs: second!.overlapFromMs!,
      keepFromMs: second!.keepFromMs,
      previousLines,
      existingLabels: ['Speaker 1', 'Speaker 2'],
    })
    expect(matches.get('2')).toBe('Speaker 1')
    expect(label('2')).toBe('Speaker 1')
    // Soniox's "1" in this job is not assumed to be the earlier "Speaker 1".
    expect(label('1')).toBe('Speaker 3')
  })

  it('does not link speakers when the overlap evidence is thin or mixed', () => {
    const sparse = [tok(' a', boundary - 30_000 - secondStart, '2'), tok(' b', boundary - 27_000 - secondStart, '2')]
    const { matches, label } = reconcileWindowSpeakers({
      tokens: sparse,
      parts: second!.parts,
      overlapFromMs: second!.overlapFromMs!,
      keepFromMs: second!.keepFromMs,
      previousLines: [{ start_ms: boundary - 45_000, end_ms: boundary, speakerLabel: 'Speaker 1' }],
      existingLabels: ['Speaker 1'],
    })
    expect(matches.size).toBe(0)
    expect(label('2')).toBe('Speaker 2')
  })
})
