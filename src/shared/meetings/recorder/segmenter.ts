import { MEETING_SAMPLE_RATE, samplesToMs } from './wav-encoder'

/** Each uploaded part is short enough to transcribe inside one server invocation. */
export const MEETING_SEGMENT_SECONDS = 90
/** Parts shorter than this (e.g. a stop right after rotation) are merged or dropped. */
export const MEETING_MIN_SEGMENT_MS = 700

export type PcmSegment = {
  idx: number
  offsetMs: number
  durationMs: number
  chunks: Int16Array[]
}

/**
 * Splits a continuous 16 kHz PCM stream into fixed-length parts. Offsets are derived
 * from the running sample count, so paused time is excluded and parts stitch exactly.
 */
export class PcmSegmenter {
  private chunks: Int16Array[] = []
  private samplesInSegment = 0
  private emittedSamples: number
  private nextIdx: number
  private readonly segmentSamples: number

  constructor(options: { startIdx?: number; startOffsetMs?: number; segmentSeconds?: number; sampleRate?: number } = {}) {
    const sampleRate = options.sampleRate ?? MEETING_SAMPLE_RATE
    this.segmentSamples = Math.round((options.segmentSeconds ?? MEETING_SEGMENT_SECONDS) * sampleRate)
    this.nextIdx = options.startIdx ?? 0
    this.emittedSamples = Math.round(((options.startOffsetMs ?? 0) / 1000) * sampleRate)
  }

  /** Total captured duration including the part in progress. */
  get totalMs() {
    return samplesToMs(this.emittedSamples + this.samplesInSegment)
  }

  get currentIdx() {
    return this.nextIdx
  }

  push(input: Int16Array): PcmSegment[] {
    const out: PcmSegment[] = []
    let rest = input
    while (rest.length) {
      const room = this.segmentSamples - this.samplesInSegment
      const take = rest.length <= room ? rest : rest.slice(0, room)
      this.chunks.push(take)
      this.samplesInSegment += take.length
      rest = rest.length <= room ? new Int16Array(0) : rest.slice(room)
      if (this.samplesInSegment >= this.segmentSamples) out.push(this.emit())
    }
    return out
  }

  /** Emit whatever is buffered (on stop, pause-with-flush, or interruption). */
  flush(): PcmSegment | null {
    if (!this.samplesInSegment) return null
    if (samplesToMs(this.samplesInSegment) < MEETING_MIN_SEGMENT_MS) {
      this.chunks = []
      this.samplesInSegment = 0
      return null
    }
    return this.emit()
  }

  private emit(): PcmSegment {
    const segment: PcmSegment = {
      idx: this.nextIdx,
      offsetMs: samplesToMs(this.emittedSamples),
      durationMs: samplesToMs(this.samplesInSegment),
      chunks: this.chunks,
    }
    this.nextIdx += 1
    this.emittedSamples += this.samplesInSegment
    this.chunks = []
    this.samplesInSegment = 0
    return segment
  }
}
