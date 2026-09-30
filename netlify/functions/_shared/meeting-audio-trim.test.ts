import { describe, expect, it } from 'vitest'
import { TRIM_PAD_MS, mapTrimmedSeconds, trimSilence } from './meeting-audio-trim'

const RATE = 16_000

type Piece = { ms: number; kind: 'tone' | 'silence' | 'noise'; amplitude?: number }

function wav(pieces: Piece[]) {
  const total = pieces.reduce((sum, p) => sum + Math.round((p.ms * RATE) / 1000), 0)
  const samples = new Int16Array(total)
  let at = 0
  let seed = 7
  for (const piece of pieces) {
    const n = Math.round((piece.ms * RATE) / 1000)
    for (let i = 0; i < n; i += 1) {
      if (piece.kind === 'tone') samples[at + i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * (piece.amplitude ?? 6000))
      else if (piece.kind === 'noise') {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        samples[at + i] = Math.round(((seed / 0x7fffffff) * 2 - 1) * (piece.amplitude ?? 800))
      }
    }
    at += n
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + total * 2, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(total * 2, 40)
  return Buffer.concat([header, Buffer.from(samples.buffer)])
}

describe('conservative silence trimming', () => {
  it('shortens long silent gaps, keeps padding, and maps timestamps back to the original', () => {
    const input = wav([
      { ms: 3000, kind: 'tone' },
      { ms: 8000, kind: 'silence' },
      { ms: 4000, kind: 'tone' },
    ])
    const result = trimSilence(input)
    expect(result.trimmed).toBe(true)
    expect(result.originalMs).toBe(15_000)
    // Only the gap interior goes; both speech edges keep ~TRIM_PAD_MS of silence.
    expect(result.sentMs).toBeGreaterThanOrEqual(7_000 + 2 * TRIM_PAD_MS - 60)
    expect(result.sentMs).toBeLessThan(9_000)
    expect(result.wav.length).toBeLessThan(input.length)

    // Second speech burst starts at 11.0s in the original.
    const secondStartTrimmed = (result.ranges[1]!.dstStartMs + TRIM_PAD_MS) / 1000
    expect(mapTrimmedSeconds(secondStartTrimmed, result.ranges)).toBeCloseTo(11, 1)
    expect(mapTrimmedSeconds(1.5, result.ranges)).toBeCloseTo(1.5, 3)
    const end = result.sentMs / 1000
    expect(mapTrimmedSeconds(end, result.ranges)).toBeCloseTo(15, 1)
  })

  it('never touches normal pauses between sentences', () => {
    const result = trimSilence(
      wav([
        { ms: 3000, kind: 'tone' },
        { ms: 1000, kind: 'silence' },
        { ms: 3000, kind: 'tone' },
        { ms: 900, kind: 'silence' },
        { ms: 3000, kind: 'tone' },
      ]),
    )
    expect(result).toMatchObject({ trimmed: false, reason: 'no_gaps' })
  })

  it('leaves audio untouched when the gain is small', () => {
    const result = trimSilence(wav([{ ms: 5000, kind: 'tone' }, { ms: 2500, kind: 'silence' }, { ms: 5000, kind: 'tone' }]))
    expect(result).toMatchObject({ trimmed: false, reason: 'little_gain' })
  })

  it('leaves noisy rooms untouched', () => {
    const result = trimSilence(
      wav([{ ms: 3000, kind: 'tone' }, { ms: 8000, kind: 'noise', amplitude: 1500 }, { ms: 3000, kind: 'tone' }]),
    )
    expect(result).toMatchObject({ trimmed: false, reason: 'noisy' })
  })

  it('leaves mostly silent audio untouched so quiet speech is never cut', () => {
    expect(trimSilence(wav([{ ms: 10_000, kind: 'silence' }])).trimmed).toBe(false)
    const result = trimSilence(wav([{ ms: 1000, kind: 'tone' }, { ms: 20_000, kind: 'silence' }]))
    expect(result).toMatchObject({ trimmed: false, reason: 'mostly_silent' })
  })

  it('keeps soft speech above the adaptive threshold', () => {
    const result = trimSilence(
      wav([
        { ms: 3000, kind: 'tone' },
        { ms: 6000, kind: 'silence' },
        { ms: 3000, kind: 'tone', amplitude: 250 },
        { ms: 6000, kind: 'silence' },
        { ms: 3000, kind: 'tone' },
      ]),
    )
    expect(result.trimmed).toBe(true)
    expect(result.ranges).toHaveLength(3)
    expect(result.sentMs).toBeGreaterThan(9_000)
  })

  it('passes non-PCM input through unchanged', () => {
    const blob = Buffer.from('not a wav file at all, just some bytes that are long enough to parse')
    const result = trimSilence(blob)
    expect(result).toMatchObject({ trimmed: false, reason: 'not_wav' })
    expect(result.wav).toBe(blob)
  })

  it('mapping is the identity when nothing was trimmed', () => {
    expect(mapTrimmedSeconds(42.5, [])).toBe(42.5)
  })
})
