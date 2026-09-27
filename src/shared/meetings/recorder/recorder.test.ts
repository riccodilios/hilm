import { describe, expect, it } from 'vitest'
import { createDownsampler, encodeWav, floatToInt16, MEETING_SAMPLE_RATE, mixToMono, samplesToMs } from './wav-encoder'
import { PcmSegmenter } from './segmenter'

describe('wav encoder', () => {
  it('writes a valid 16 kHz mono PCM header and payload', async () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767, -32768])
    const blob = encodeWav([pcm])
    const bytes = new DataView(await blob.arrayBuffer())
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(bytes.buffer, offset, 4))
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + pcm.length * 2)
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(text(36)).toBe('data')
    expect(bytes.getUint32(4, true)).toBe(36 + pcm.length * 2)
    expect(bytes.getUint16(22, true)).toBe(1)
    expect(bytes.getUint32(24, true)).toBe(MEETING_SAMPLE_RATE)
    expect(bytes.getUint16(34, true)).toBe(16)
    expect(bytes.getInt16(44 + 2, true)).toBe(1000)
    expect(bytes.getInt16(44 + 8, true)).toBe(-32768)
  })

  it('only writes the viewed bytes of subarray chunks', async () => {
    const backing = new Int16Array([9, 9, 1, 2, 9, 9])
    const blob = encodeWav([backing.subarray(2, 4)])
    const view = new DataView(await blob.arrayBuffer())
    expect(blob.size).toBe(44 + 4)
    expect(view.getInt16(44, true)).toBe(1)
    expect(view.getInt16(46, true)).toBe(2)
  })

  it('clamps float samples into int16 range', () => {
    expect(Array.from(floatToInt16(new Float32Array([2, -2, 0])))).toEqual([32767, -32768, 0])
  })

  it('mixes channels to mono', () => {
    const mono = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])])
    expect(Array.from(mono)).toEqual([0.5, 0.5])
  })

  it('downsamples 48 kHz to 16 kHz without drift across buffers', () => {
    const downsample = createDownsampler(48_000)
    let total = 0
    for (let i = 0; i < 100; i += 1) total += downsample(new Float32Array(4096).fill(0.25)).length
    const expected = (100 * 4096) / 3
    expect(Math.abs(total - expected)).toBeLessThanOrEqual(1)
  })

  it('handles non-integer ratios (44.1 kHz) and preserves DC level', () => {
    const downsample = createDownsampler(44_100)
    let total = 0
    let last = 0
    for (let i = 0; i < 50; i += 1) {
      const out = downsample(new Float32Array(2048).fill(0.5))
      total += out.length
      if (out.length) last = out[out.length - 1]!
    }
    expect(Math.abs(total - (50 * 2048 * 16_000) / 44_100)).toBeLessThanOrEqual(1)
    expect(last).toBe(Math.round(0.5 * 0x7fff))
  })
})

describe('PcmSegmenter', () => {
  const second = MEETING_SAMPLE_RATE

  it('rotates parts at the segment length with contiguous offsets', () => {
    const segmenter = new PcmSegmenter({ segmentSeconds: 2 })
    const out = [
      ...segmenter.push(new Int16Array(second * 3)),
      ...segmenter.push(new Int16Array(second * 2)),
    ]
    expect(out.map((s) => [s.idx, s.offsetMs, s.durationMs])).toEqual([
      [0, 0, 2000],
      [1, 2000, 2000],
    ])
    expect(segmenter.totalMs).toBe(5000)
    const tail = segmenter.flush()
    expect(tail).toMatchObject({ idx: 2, offsetMs: 4000, durationMs: 1000 })
    expect(segmenter.currentIdx).toBe(3)
  })

  it('keeps sample-exact offsets when a buffer straddles a boundary', () => {
    const segmenter = new PcmSegmenter({ segmentSeconds: 1 })
    const parts = segmenter.push(new Int16Array(Math.round(second * 2.5)))
    expect(parts).toHaveLength(2)
    expect(parts[0]!.chunks.reduce((n, c) => n + c.length, 0)).toBe(second)
    expect(parts[1]!.offsetMs).toBe(1000)
  })

  it('drops tiny remainders on flush', () => {
    const segmenter = new PcmSegmenter({ segmentSeconds: 2 })
    segmenter.push(new Int16Array(Math.round(second * 0.3)))
    expect(segmenter.flush()).toBeNull()
    expect(segmenter.currentIdx).toBe(0)
  })

  it('continues numbering and offsets when resuming a meeting', () => {
    const segmenter = new PcmSegmenter({ startIdx: 4, startOffsetMs: 360_000, segmentSeconds: 90 })
    segmenter.push(new Int16Array(second * 10))
    const part = segmenter.flush()
    expect(part).toMatchObject({ idx: 4, offsetMs: 360_000, durationMs: 10_000 })
    expect(samplesToMs(second * 90)).toBe(90_000)
  })

  it('supports 90+ minute meetings as 60+ parts', () => {
    const segmenter = new PcmSegmenter()
    let parts = 0
    for (let minute = 0; minute < 95; minute += 1) parts += segmenter.push(new Int16Array(second * 60)).length
    const tail = segmenter.flush()
    expect(parts + (tail ? 1 : 0)).toBe(Math.ceil((95 * 60) / 90))
    expect(segmenter.totalMs).toBe(95 * 60 * 1000)
  })
})
