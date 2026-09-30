/**
 * Meeting STT via the central AI gateway.
 * No database or storage access — used by the engine and live accuracy tests.
 */
import {
  MEETING_TRANSCRIBE_MODEL,
  dedupeTranscriptionLoops,
  extractJsonObject,
  parseTranscriptionJson,
  salvageTruncatedTranscription,
  type TranscriptionResponse,
} from './meeting-core'
import { getAiRuntimeConfig } from './ai-config'
import {
  AI_GATEWAY_TIMEOUT_MS,
  MEETING_STT_DEADLINE_MS,
  runAiCompletion,
  streamAiCompletion,
} from './ai-gateway'
import { addUsage, tokensFromOpenRouterUsage } from './ai-guard'
import { mapTrimmedSeconds, trimSilence, type TimeRange } from './meeting-audio-trim'

export { AI_GATEWAY_TIMEOUT_MS as PROVIDER_TIMEOUT_MS, MEETING_STT_DEADLINE_MS }

export const MEETING_STT_MAX_TOKENS = 8192
/**
 * Output budget per second of audio sent. Dense two-speaker speech measured ~6 output
 * tokens/s in the compact format; the cap stops hallucination loops on silence/noise early.
 */
export const MEETING_STT_TOKENS_PER_AUDIO_SECOND = 40
const MEETING_STT_MIN_TOKENS = 512

export function sttMaxTokens(audioSeconds: number | null) {
  if (!audioSeconds || !Number.isFinite(audioSeconds)) return MEETING_STT_MAX_TOKENS
  return Math.min(MEETING_STT_MAX_TOKENS, MEETING_STT_MIN_TOKENS + Math.ceil(audioSeconds * MEETING_STT_TOKENS_PER_AUDIO_SECOND))
}

export type OpenRouterResult =
  | { ok: true; content: string; usage: unknown }
  | { ok: false; code: 'provider_error' | 'provider_timeout' | 'disabled' | 'rate_limited' | 'invalid_request'; detail: string }

/** @deprecated Prefer runAiCompletion from ai-gateway for new code. Kept for tests. */
export async function callOpenRouter(
  apiKey: string,
  body: Record<string, unknown>,
  title: string,
  timeoutMs = AI_GATEWAY_TIMEOUT_MS,
): Promise<OpenRouterResult> {
  const messages = (body.messages ?? []) as Parameters<typeof runAiCompletion>[0]['messages']
  const result = await runAiCompletion({
    apiKey,
    feature: 'meeting_analyze',
    model: typeof body.model === 'string' ? body.model : undefined,
    messages,
    maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : 4096,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
    responseFormat: body.response_format as { type: 'json_object' } | undefined,
    timeoutMs,
    title,
    allowRetry: false,
  })
  if (!result.ok) {
    const code =
      result.code === 'disabled' || result.code === 'rate_limited' || result.code === 'invalid_request'
        ? result.code
        : result.code === 'provider_timeout'
          ? 'provider_timeout'
          : 'provider_error'
    return { ok: false, code, detail: result.detail }
  }
  return { ok: true, content: result.content, usage: result.usage }
}

/** Audio actually sent to the provider (after silence trimming) vs the recorded part. */
export type TranscribeAudioInfo = { originalMs: number; sentMs: number; trimmed: boolean }

export type TranscribeChunkResult = (
  | { ok: true; data: TranscriptionResponse; content: string; usage: unknown }
  | {
      ok: false
      code:
        | 'provider_error'
        | 'provider_timeout'
        | 'parse_error'
        | 'output_truncated'
        | 'disabled'
        | 'rate_limited'
        | 'invalid_request'
      detail: string
      content?: string
      usage?: unknown
    }
) & { audio: TranscribeAudioInfo }

/**
 * Transcribes one WAV chunk and validates the JSON reply.
 *
 * Every provider call is bounded by `deadlineMs` so it ends before the Netlify function
 * does (the platform kills synchronous functions at ~26s regardless of netlify.toml).
 * A whole chunk whose reply is cut off returns `output_truncated` so the caller can retry
 * with `split: true`, which transcribes the two halves in parallel within the same budget.
 *
 * Long silent gaps are shortened before sending (see meeting-audio-trim); returned
 * timestamps are mapped back onto the original part.
 */
export async function transcribeAudioChunk(input: {
  apiKey: string
  audioBase64: string
  prompt: string
  deadlineMs?: number
  model?: string
  split?: boolean
  /** Defaults to true. */
  trimSilence?: boolean
}): Promise<TranscribeChunkResult> {
  const deadlineMs = input.deadlineMs ?? MEETING_STT_DEADLINE_MS
  const original = Buffer.from(input.audioBase64, 'base64')
  const trim = input.trimSilence === false ? null : trimSilence(original)
  const wav = trim?.trimmed ? trim.wav : original
  const audio: TranscribeAudioInfo = {
    originalMs: trim?.originalMs ?? 0,
    sentMs: trim?.sentMs ?? 0,
    trimmed: Boolean(trim?.trimmed),
  }
  const ranges = trim?.trimmed ? trim.ranges : []
  const audioBase64 = trim?.trimmed ? wav.toString('base64') : input.audioBase64

  const halves = input.split ? splitWav(wav) : null
  if (!halves) {
    const result = await transcribeOnce({ ...input, audioBase64, deadlineMs, audioSeconds: wavSeconds(wav) })
    if (result.ok && result.truncated) {
      return {
        ok: false,
        code: 'output_truncated',
        detail: 'Reply cut off before the end of the audio',
        content: result.content,
        usage: result.usage,
        audio,
      }
    }
    if (!result.ok) return { ...result, audio }
    return { ok: true, data: remapTimes(result.data, ranges), content: result.content, usage: result.usage, audio }
  }

  const [first, second] = await Promise.all(
    halves.parts.map((part, i) =>
      transcribeOnce({
        ...input,
        deadlineMs,
        audioBase64: part.toString('base64'),
        audioSeconds: wavSeconds(part),
        prompt: `${input.prompt}\nThis audio is the ${i === 0 ? 'first' : 'second'} half of the part; times start at 0 for this half.`,
      }),
    ),
  )
  const usage = sumUsage(first!.usage, second!.usage)
  if (!first!.ok) return { ...first!, usage, audio }
  if (!second!.ok) return { ...second!, usage, audio }
  const offset = halves.firstSeconds
  const speakers = new Map<string, { label: string; description?: string | null }>()
  for (const speaker of [...(first!.data.speakers ?? []), ...(second!.data.speakers ?? [])]) {
    if (!speakers.has(speaker.label)) speakers.set(speaker.label, speaker)
  }
  const data: TranscriptionResponse = {
    segments: [
      ...first!.data.segments,
      ...second!.data.segments.map((segment) => ({
        ...segment,
        start: segment.start + offset,
        end: segment.end === undefined ? undefined : segment.end + offset,
      })),
    ],
    speakers: [...speakers.values()],
  }
  return {
    ok: true,
    data: remapTimes(data, ranges),
    content: `${first!.content}\n${second!.content}`,
    usage,
    audio,
  }
}

function remapTimes(data: TranscriptionResponse, ranges: TimeRange[]): TranscriptionResponse {
  if (!ranges.length) return data
  return {
    ...data,
    segments: data.segments.map((segment) => ({
      ...segment,
      start: mapTrimmedSeconds(segment.start, ranges),
      end: segment.end === undefined ? undefined : mapTrimmedSeconds(segment.end, ranges),
    })),
  }
}

type SingleResult =
  | { ok: true; data: TranscriptionResponse; content: string; usage: unknown; truncated: boolean }
  | Omit<Extract<TranscribeChunkResult, { ok: false }>, 'audio'>

async function transcribeOnce(input: {
  apiKey: string
  audioBase64: string
  prompt: string
  deadlineMs: number
  model?: string
  audioSeconds: number | null
}): Promise<SingleResult> {
  const config = getAiRuntimeConfig()
  const seconds = input.audioSeconds
  const prompt = seconds
    ? `${input.prompt}\nThis audio is ${seconds.toFixed(1)} s long.`
    : input.prompt
  const result = await streamAiCompletion({
    apiKey: input.apiKey,
    feature: 'meeting_transcription',
    model: input.model || config.models.meeting_transcription || MEETING_TRANSCRIBE_MODEL,
    maxTokens: sttMaxTokens(seconds),
    temperature: 0,
    responseFormat: { type: 'json_object' },
    deadlineMs: input.deadlineMs,
    title: 'Hilm Meeting Transcription',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'input_audio', input_audio: { data: input.audioBase64, format: 'wav' } },
        ],
      },
    ],
  })
  if (!result.ok) {
    return { ok: false, code: result.code, detail: result.detail, usage: result.usage }
  }
  const data = parseTranscriptionContent(result.content)
  if (!data) {
    return {
      ok: false,
      code: result.truncated ? 'output_truncated' : 'parse_error',
      detail: `${result.truncated ? '[truncated] ' : ''}${result.content.slice(0, 300)}`,
      content: result.content,
      usage: result.usage,
    }
  }
  return { ok: true, data, content: result.content, usage: result.usage, truncated: result.truncated }
}

/** Sums the two halves' usage back into OpenRouter's usage shape (tokens, details, cost). */
function sumUsage(a: unknown, b: unknown) {
  const x = tokensFromOpenRouterUsage(a)
  const y = tokensFromOpenRouterUsage(b)
  if (!x.totalTokens || !y.totalTokens) return undefined
  const sum = addUsage(x, y)
  return {
    prompt_tokens: sum.inputTokens,
    completion_tokens: sum.outputTokens,
    total_tokens: sum.totalTokens,
    prompt_tokens_details: { cached_tokens: sum.cachedTokens ?? 0, audio_tokens: sum.audioTokens ?? 0 },
    ...(typeof sum.costUsd === 'number' ? { cost: sum.costUsd } : {}),
  }
}

/** Duration of a RIFF/WAVE file from its data chunk, or null when it cannot be read. */
export function wavSeconds(wav: Buffer): number | null {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return null
  let offset = 12
  let byteRate = 0
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'fmt ' && size >= 16) byteRate = wav.readUInt32LE(offset + 16)
    if (id === 'data') {
      if (!byteRate) return null
      return Math.min(size, wav.length - offset - 8) / byteRate
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

/**
 * Splits a PCM WAV into two playable halves at a sample boundary.
 * Returns null for anything that is not a plain PCM RIFF/WAVE file.
 */
export function splitWav(wav: Buffer): { parts: [Buffer, Buffer]; firstSeconds: number } | null {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    return null
  }
  let offset = 12
  let fmt: Buffer | null = null
  let dataStart = -1
  let dataSize = 0
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'fmt ') fmt = wav.subarray(offset + 8, offset + 8 + size)
    if (id === 'data') {
      dataStart = offset + 8
      dataSize = Math.min(size, wav.length - dataStart)
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (!fmt || fmt.length < 16 || dataStart < 0) return null
  const byteRate = fmt.readUInt32LE(8)
  const blockAlign = fmt.readUInt16LE(12)
  if (!byteRate || !blockAlign) return null
  const half = Math.floor(dataSize / 2 / blockAlign) * blockAlign
  if (half <= 0) return null
  const build = (pcm: Buffer) => {
    const header = Buffer.alloc(20)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(4 + 8 + fmt!.length + 8 + pcm.length, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(fmt!.length, 16)
    const dataHeader = Buffer.alloc(8)
    dataHeader.write('data', 0, 'ascii')
    dataHeader.writeUInt32LE(pcm.length, 4)
    return Buffer.concat([header, fmt!, dataHeader, pcm])
  }
  const pcm = wav.subarray(dataStart, dataStart + dataSize)
  return { parts: [build(pcm.subarray(0, half)), build(pcm.subarray(half))], firstSeconds: half / byteRate }
}

/**
 * Parses the model's transcription JSON. A reply cut off at max_tokens is salvaged down
 * to its complete segments rather than discarded — re-running the same audio would be
 * billed again and truncate the same way.
 */
export function parseTranscriptionContent(content: string): TranscriptionResponse | null {
  const json = extractJsonObject(content)
  const data = (json ? parseTranscriptionJson(json) : null) ?? salvageTruncatedTranscription(content)
  return data ? dedupeTranscriptionLoops(data) : null
}
