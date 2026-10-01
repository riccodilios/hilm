/** Pure helpers for Soniox meeting transcription: context, token → line mapping, cost, WAV joining. */
import { MEETING_SEGMENT_ORDINAL_STRIDE, resolveSegmentLanguageMeta, normalizeLanguageCode } from './meeting-core'
import type { SonioxContext, SonioxToken, SonioxTranscript } from './soniox'

export const SONIOX_PRICING_MODEL = 'soniox/stt-async-v5'
/** Soniox async accepts files up to 300 minutes; longer meetings go straight to Gemini. */
export const SONIOX_MAX_AUDIO_MS = 300 * 60_000
export const SONIOX_LANGUAGE_HINTS = ['ar', 'en']
export const SONIOX_WEBHOOK_HEADER = 'X-Hilm-Webhook-Token'

/** Soniox async list price: $1.50 / 1M audio tokens, $3.50 / 1M text tokens (~30k audio tokens/hour). */
const AUDIO_TOKENS_PER_HOUR = 30_000
const AUDIO_USD_PER_TOKEN = 1.5 / 1_000_000
const TEXT_USD_PER_TOKEN = 3.5 / 1_000_000
const TEXT_TOKENS_PER_CHAR = 0.3
const MAX_CONTEXT_CHARS = 9_000

export function sonioxReference(os: string, meetingId: string) {
  return `hilm:${os}:${meetingId}`
}

export function buildSonioxContext(input: {
  title?: string | null
  projectName?: string | null
  vocabulary: string[]
}): SonioxContext {
  const general: Array<{ key: string; value: string }> = [
    { key: 'domain', value: 'Business meeting' },
    {
      key: 'languages',
      value: 'Arabic (any dialect) and English. Speakers may switch languages between and within sentences.',
    },
    {
      key: 'instructions',
      value:
        'Transcribe verbatim in the language actually spoken. Keep Arabic in Arabic script and English in Latin script. Do not translate or transliterate. Keep English names, products, companies and technical terms in English.',
    },
  ]
  const project = input.projectName?.trim()
  const title = input.title?.trim()
  if (project) general.push({ key: 'project', value: project.slice(0, 200) })
  if (title) general.push({ key: 'topic', value: title.slice(0, 200) })

  const terms: string[] = []
  const seen = new Set<string>()
  let size = JSON.stringify(general).length
  for (const raw of [project ?? '', ...input.vocabulary]) {
    const term = raw.trim().slice(0, 100)
    const key = term.toLowerCase()
    if (!term || seen.has(key)) continue
    if (size + term.length + 3 > MAX_CONTEXT_CHARS) break
    seen.add(key)
    terms.push(term)
    size += term.length + 3
  }
  return terms.length ? { general, terms } : { general }
}

export function sonioxContextChars(context: SonioxContext) {
  return JSON.stringify(context).length
}

export type SonioxUsage = {
  audioTokens: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/** Soniox does not report per-job usage, so cost comes from Soniox's own token rates. */
export function estimateSonioxUsage(input: { audioMs: number; outputText: string; contextChars: number }): SonioxUsage {
  const audioTokens = Math.ceil((Math.max(0, input.audioMs) * AUDIO_TOKENS_PER_HOUR) / 3_600_000)
  const contextTokens = Math.ceil(Math.max(0, input.contextChars) * TEXT_TOKENS_PER_CHAR)
  const outputTokens = Math.ceil(input.outputText.length * TEXT_TOKENS_PER_CHAR)
  const costUsd = audioTokens * AUDIO_USD_PER_TOKEN + (contextTokens + outputTokens) * TEXT_USD_PER_TOKEN
  return {
    audioTokens,
    inputTokens: audioTokens + contextTokens,
    outputTokens,
    costUsd: Math.round(costUsd * 1e8) / 1e8,
  }
}

export type SonioxAudioPart = { id: string; idx: number; offset_ms: number; duration_ms: number }

export type SonioxLine = {
  audioSegmentId: string
  speakerLabel: string
  start_ms: number
  end_ms: number
  text: string
  language: string | null
  languages: string[]
  ordinal: number
}

const SENTENCE_END_RE = /[.!?؟。]\s*$/
const SOFT_LINE_MS = 30_000
const HARD_LINE_MS = 60_000
const PAUSE_BREAK_MS = 3_000

/**
 * Soniox speaker ids map to "Speaker <id>" unchanged. Non-numeric ids (not expected from the
 * API) get the next free number in first-appearance order so identities stay distinct.
 */
function speakerLabeler() {
  const assigned = new Map<string, string>()
  const used = new Set<number>()
  return (raw: SonioxToken['speaker']) => {
    const key = raw === null || raw === undefined || String(raw).trim() === '' ? '1' : String(raw).trim()
    const known = assigned.get(key)
    if (known) return known
    let n = /^\d{1,3}$/.test(key) ? Number(key) : 0
    if (!n || used.has(n)) {
      n = 1
      while (used.has(n)) n += 1
    }
    used.add(n)
    const label = `Speaker ${n}`
    assigned.set(key, label)
    return label
  }
}

/**
 * Turn Soniox tokens (full-meeting timeline) into Hilm transcript lines. Lines break on speaker
 * changes, long pauses and long monologues; text is concatenated exactly as Soniox returned it.
 * Times are mapped from the joined-audio timeline back onto each recorded part's offset.
 */
export function sonioxTokensToLines(tokens: SonioxToken[], parts: SonioxAudioPart[]): SonioxLine[] {
  const ordered = [...parts].sort((a, b) => a.idx - b.idx)
  if (!ordered.length) return []
  const starts: number[] = []
  let cursor = 0
  for (const part of ordered) {
    starts.push(cursor)
    cursor += Math.max(0, part.duration_ms)
  }
  const partAt = (t: number) => {
    let i = 0
    while (i + 1 < ordered.length && t >= starts[i + 1]!) i += 1
    return i
  }
  const toMeetingMs = (t: number, i: number) => {
    const part = ordered[i]!
    const local = Math.min(Math.max(0, t - starts[i]!), Math.max(0, part.duration_ms))
    return part.offset_ms + local
  }

  const label = speakerLabeler()
  type Draft = { speaker: string; start: number; end: number; text: string; langChars: Map<string, number> }
  const drafts: Draft[] = []
  let current: Draft | null = null

  for (const token of tokens) {
    if (token.translation_status === 'translation') continue
    if (!token.text) continue
    const speaker = label(token.speaker)
    const start = Math.max(0, Math.round(token.start_ms))
    const end = Math.max(start, Math.round(token.end_ms))
    const startsWord = /^\s/.test(token.text)
    if (current) {
      const duration = start - current.start
      const gap = start - current.end
      const breakHere =
        speaker !== current.speaker ||
        gap >= PAUSE_BREAK_MS ||
        (duration >= SOFT_LINE_MS && startsWord && SENTENCE_END_RE.test(current.text)) ||
        (duration >= HARD_LINE_MS && startsWord)
      if (breakHere) {
        drafts.push(current)
        current = null
      }
    }
    if (!current) current = { speaker, start, end, text: '', langChars: new Map() }
    current.text += token.text
    current.end = Math.max(current.end, end)
    const lang = normalizeLanguageCode(token.language)
    if (lang) current.langChars.set(lang, (current.langChars.get(lang) ?? 0) + token.text.trim().length)
  }
  if (current) drafts.push(current)

  const perPart = new Map<number, number>()
  const lines: SonioxLine[] = []
  for (const draft of drafts) {
    const text = draft.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const i = partAt(draft.start)
    const part = ordered[i]!
    const startMs = toMeetingMs(draft.start, i)
    const endPart = partAt(draft.end)
    const endMs = Math.max(startMs, toMeetingMs(draft.end, endPart))
    const ranked = [...draft.langChars.entries()].sort((a, b) => b[1] - a[1])
    const meta = resolveSegmentLanguageMeta({
      language: ranked[0]?.[0] ?? null,
      languages: ranked.map(([code]) => code),
      text,
    })
    const n = perPart.get(part.idx) ?? 0
    perPart.set(part.idx, n + 1)
    lines.push({
      audioSegmentId: part.id,
      speakerLabel: draft.speaker,
      start_ms: startMs,
      end_ms: endMs,
      text,
      language: meta.language,
      languages: meta.languages,
      ordinal: part.idx * MEETING_SEGMENT_ORDINAL_STRIDE + Math.min(n, MEETING_SEGMENT_ORDINAL_STRIDE - 1),
    })
  }
  return lines
}

/**
 * A transcript is unusable when it is empty although a meaningful amount of audio was sent,
 * or when its token timeline runs far past the audio (a structurally broken response).
 */
export function sonioxTranscriptProblem(transcript: SonioxTranscript, audioMs: number): string | null {
  const spoken = transcript.tokens.some((token) => token.text.trim().length > 0)
  if (!spoken && audioMs >= 60_000) return 'empty_transcript'
  const last = transcript.tokens.reduce((max, token) => Math.max(max, token.end_ms), 0)
  if (audioMs > 0 && last > audioMs + 60_000) return 'timeline_mismatch'
  return null
}

// ── WAV joining ─────────────────────────────────────────────────────────────

export type PcmFormat = { sampleRate: number; channels: number; bitsPerSample: number }

/** Locate the PCM payload of a RIFF/WAVE file. Returns null for anything but plain PCM. */
export function parseWavPcm(bytes: Uint8Array): { format: PcmFormat; data: Uint8Array } | null {
  if (bytes.length < 44) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!)
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') return null
  let format: PcmFormat | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) return null
      if (view.getUint16(body, true) !== 1) return null
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      if (!format) return null
      const end = Math.min(bytes.length, body + size)
      return { format, data: bytes.subarray(body, end) }
    }
    offset = body + size + (size % 2)
  }
  return null
}

export function sameFormat(a: PcmFormat, b: PcmFormat) {
  return a.sampleRate === b.sampleRate && a.channels === b.channels && a.bitsPerSample === b.bitsPerSample
}

export function buildWavHeader(format: PcmFormat, dataBytes: number): Uint8Array {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) header[at + i] = text.charCodeAt(i)
  }
  const blockAlign = (format.channels * format.bitsPerSample) / 8
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, format.channels, true)
  view.setUint32(24, format.sampleRate, true)
  view.setUint32(28, format.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, format.bitsPerSample, true)
  write(36, 'data')
  view.setUint32(40, dataBytes, true)
  return header
}

export function pcmDurationMs(format: PcmFormat, dataBytes: number) {
  const bytesPerSecond = (format.sampleRate * format.channels * format.bitsPerSample) / 8
  return bytesPerSecond > 0 ? Math.round((dataBytes / bytesPerSecond) * 1000) : 0
}
