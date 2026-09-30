/**
 * Conservative silence trimming for meeting STT parts (16-bit PCM WAV).
 *
 * Audio is billed per second (~25 tokens/s), so long silent stretches cost money and invite
 * hallucinated text. Only long, clearly silent gaps are shortened; a padding of silence stays on
 * both sides of every speech edge, and a time map converts model timestamps on the trimmed audio
 * back to the original part. When anything is uncertain (noisy room, little to gain, mostly
 * silent audio, unexpected WAV layout) the original audio is sent unchanged.
 */

export const TRIM_FRAME_MS = 30
/** Silent runs shorter than this are never touched (normal pauses between sentences). */
export const TRIM_MIN_GAP_MS = 1_200
/** Silence kept on each side of a speech edge inside a trimmed gap. */
export const TRIM_PAD_MS = 350
/** Skip trimming unless it saves at least this much audio. */
export const TRIM_MIN_SAVED_MS = 3_000
/** Skip trimming when less than this share of the audio would remain (likely all silence/noise). */
export const TRIM_MIN_KEEP_RATIO = 0.35
/** Rooms noisier than this RMS floor are sent untouched (cannot separate soft speech reliably). */
export const TRIM_MAX_NOISE_FLOOR = 200
const THRESHOLD_MIN = 60
const THRESHOLD_MAX = 400

export type TimeRange = { srcStartMs: number; srcEndMs: number; dstStartMs: number }

export type TrimResult = {
  wav: Buffer
  trimmed: boolean
  originalMs: number
  sentMs: number
  /** Kept ranges in order; empty when not trimmed. */
  ranges: TimeRange[]
  reason: 'trimmed' | 'not_wav' | 'noisy' | 'little_gain' | 'mostly_silent' | 'no_gaps'
}

type Pcm = { samples: Int16Array; sampleRate: number }

function readPcm16Mono(wav: Buffer): Pcm | null {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return null
  let offset = 12
  let fmt: Buffer | null = null
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'fmt ') fmt = wav.subarray(offset + 8, offset + 8 + size)
    if (id === 'data') {
      if (!fmt || fmt.length < 16) return null
      const format = fmt.readUInt16LE(0)
      const channels = fmt.readUInt16LE(2)
      const sampleRate = fmt.readUInt32LE(4)
      const bits = fmt.readUInt16LE(14)
      if (format !== 1 || channels !== 1 || bits !== 16 || !sampleRate) return null
      const start = offset + 8
      const bytes = Math.min(size, wav.length - start) & ~1
      const copy = new Uint8Array(bytes)
      copy.set(wav.subarray(start, start + bytes))
      return { samples: new Int16Array(copy.buffer, 0, bytes / 2), sampleRate }
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

function buildWav(sampleRate: number, samples: Int16Array) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + samples.length * 2, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(samples.length * 2, 40)
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)])
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}

export function trimSilence(wav: Buffer): TrimResult {
  const pcm = readPcm16Mono(wav)
  if (!pcm) return { wav, trimmed: false, originalMs: 0, sentMs: 0, ranges: [], reason: 'not_wav' }
  const { samples, sampleRate } = pcm
  const originalMs = Math.round((samples.length / sampleRate) * 1000)
  const untouched = (reason: TrimResult['reason']): TrimResult => ({
    wav,
    trimmed: false,
    originalMs,
    sentMs: originalMs,
    ranges: [],
    reason,
  })

  const frame = Math.max(1, Math.round((sampleRate * TRIM_FRAME_MS) / 1000))
  const frames = Math.floor(samples.length / frame)
  if (frames < 2) return untouched('no_gaps')
  const rms: number[] = new Array(frames)
  for (let f = 0; f < frames; f += 1) {
    let sum = 0
    for (let i = f * frame; i < (f + 1) * frame; i += 1) sum += samples[i]! * samples[i]!
    rms[f] = Math.sqrt(sum / frame)
  }
  const noiseFloor = percentile(rms, 0.1)
  if (noiseFloor > TRIM_MAX_NOISE_FLOOR) return untouched('noisy')
  const threshold = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, noiseFloor * 2.5))

  const minGapFrames = Math.ceil(TRIM_MIN_GAP_MS / TRIM_FRAME_MS)
  const padFrames = Math.ceil(TRIM_PAD_MS / TRIM_FRAME_MS)
  // Frames to drop: the middle of each long silent run, leaving padding next to speech.
  const drop: Array<[number, number]> = []
  let speechFrames = 0
  for (let f = 0; f < frames; ) {
    if (rms[f]! >= threshold) {
      speechFrames += 1
      f += 1
      continue
    }
    let end = f
    while (end < frames && rms[end]! < threshold) end += 1
    if (end - f >= minGapFrames) {
      const from = f === 0 ? 0 : f + padFrames
      const to = end === frames ? frames : end - padFrames
      if (to - from > 0) drop.push([from, to])
    }
    f = end
  }
  if (!speechFrames) return untouched('mostly_silent')
  if (!drop.length) return untouched('no_gaps')

  const droppedFrames = drop.reduce((sum, [a, b]) => sum + (b - a), 0)
  const droppedMs = droppedFrames * TRIM_FRAME_MS
  const keptMs = originalMs - droppedMs
  if (droppedMs < TRIM_MIN_SAVED_MS) return untouched('little_gain')
  if (keptMs / originalMs < TRIM_MIN_KEEP_RATIO) return untouched('mostly_silent')

  const ranges: TimeRange[] = []
  const pieces: Int16Array[] = []
  let cursorSample = 0
  let dstSamples = 0
  const keep = (fromSample: number, toSample: number) => {
    if (toSample <= fromSample) return
    ranges.push({
      srcStartMs: (fromSample / sampleRate) * 1000,
      srcEndMs: (toSample / sampleRate) * 1000,
      dstStartMs: (dstSamples / sampleRate) * 1000,
    })
    pieces.push(samples.subarray(fromSample, toSample))
    dstSamples += toSample - fromSample
  }
  for (const [a, b] of drop) {
    keep(cursorSample, a * frame)
    cursorSample = b === frames ? samples.length : b * frame
  }
  keep(cursorSample, samples.length)

  const out = new Int16Array(dstSamples)
  let at = 0
  for (const piece of pieces) {
    out.set(piece, at)
    at += piece.length
  }
  return {
    wav: buildWav(sampleRate, out),
    trimmed: true,
    originalMs,
    sentMs: Math.round((dstSamples / sampleRate) * 1000),
    ranges,
    reason: 'trimmed',
  }
}

/** Maps a time in the trimmed audio (seconds) back to the original part (seconds). */
export function mapTrimmedSeconds(seconds: number, ranges: TimeRange[]): number {
  if (!ranges.length || !Number.isFinite(seconds)) return seconds
  const ms = Math.max(0, seconds * 1000)
  for (const range of ranges) {
    const length = range.srcEndMs - range.srcStartMs
    if (ms <= range.dstStartMs + length) {
      return (range.srcStartMs + Math.max(0, ms - range.dstStartMs)) / 1000
    }
  }
  const last = ranges[ranges.length - 1]!
  return (last.srcEndMs + (ms - last.dstStartMs - (last.srcEndMs - last.srcStartMs))) / 1000
}
