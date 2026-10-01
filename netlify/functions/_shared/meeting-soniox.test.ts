import { describe, expect, it } from 'vitest'
import {
  buildSonioxContext,
  buildWavHeader,
  estimateSonioxUsage,
  parseWavPcm,
  pcmDurationMs,
  sameFormat,
  sonioxReference,
  sonioxTokensToLines,
  sonioxTranscriptProblem,
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
