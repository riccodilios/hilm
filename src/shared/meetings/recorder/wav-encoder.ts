/** PCM capture helpers: streaming downsampler to 16 kHz mono Int16 and WAV container encoding. */

export const MEETING_SAMPLE_RATE = 16_000

/**
 * Streaming box-filter downsampler. Keeps fractional position across calls so
 * consecutive buffers produce a continuous signal with no drift.
 */
export function createDownsampler(inputRate: number, outputRate = MEETING_SAMPLE_RATE) {
  const ratio = inputRate / outputRate
  let carry: Float32Array = new Float32Array(0)
  let position = 0

  return function downsample(input: Float32Array): Int16Array {
    if (ratio === 1) return floatToInt16(input)
    const data = new Float32Array(carry.length + input.length)
    data.set(carry, 0)
    data.set(input, carry.length)

    const outLength = Math.max(0, Math.floor((data.length - position) / ratio))
    const out = new Int16Array(outLength)
    for (let i = 0; i < outLength; i += 1) {
      const start = position + i * ratio
      const end = start + ratio
      const from = Math.floor(start)
      const to = Math.min(data.length, Math.ceil(end))
      let sum = 0
      let count = 0
      for (let j = from; j < to; j += 1) {
        sum += data[j]!
        count += 1
      }
      out[i] = toInt16(count ? sum / count : 0)
    }
    const consumed = position + outLength * ratio
    const keepFrom = Math.floor(consumed)
    carry = data.slice(keepFrom)
    position = consumed - keepFrom
    return out
  }
}

function toInt16(sample: number) {
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
}

export function floatToInt16(input: Float32Array) {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i += 1) out[i] = toInt16(input[i]!)
  return out
}

/** Mix any number of channels down to mono. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!
  const length = channels[0]?.length ?? 0
  const out = new Float32Array(length)
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) out[i]! += channel[i]! / channels.length
  }
  return out
}

/** Encode 16-bit mono PCM chunks into a WAV blob. */
export function encodeWav(chunks: Int16Array[], sampleRate = MEETING_SAMPLE_RATE): Blob {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const dataBytes = sampleCount * 2
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataBytes, true)
  const parts = chunks.map(
    (chunk) => new Uint8Array(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength),
  )
  return new Blob([header, ...parts], { type: 'audio/wav' })
}

export function samplesToMs(samples: number, sampleRate = MEETING_SAMPLE_RATE) {
  return Math.round((samples / sampleRate) * 1000)
}

/** Root-mean-square level (0..1) for a mic level meter. */
export function rmsLevel(input: Float32Array) {
  if (!input.length) return 0
  let sum = 0
  for (let i = 0; i < input.length; i += 1) sum += input[i]! * input[i]!
  return Math.min(1, Math.sqrt(sum / input.length) * 3)
}
