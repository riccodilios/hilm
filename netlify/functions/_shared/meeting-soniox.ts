/** Pure helpers for Soniox meeting transcription: context, token → line mapping, cost, WAV joining. */
import { MEETING_SEGMENT_ORDINAL_STRIDE, resolveSegmentLanguageMeta, normalizeLanguageCode } from './meeting-core'
import type { SonioxContext, SonioxToken, SonioxTranscript } from './soniox'

export const SONIOX_PRICING_MODEL = 'soniox/stt-async-v5'
/** Soniox async accepts files up to 300 minutes (fixed limit, see Soniox "Limits & quotas"). */
export const SONIOX_MAX_AUDIO_MS = 300 * 60_000
/**
 * Audio per Soniox job. Longer meetings are split into consecutive windows: each stays far below
 * the 300-minute file limit and small enough (~230 MB of 16 kHz PCM) to join in the background
 * function's memory.
 */
export const SONIOX_WINDOW_MAX_MS = 120 * 60_000
/** Lines of a later window that start inside the shared overlap part get ordinals above this. */
const OVERLAP_ORDINAL_BASE = 5_000
export const SONIOX_LANGUAGE_HINTS = ['ar', 'en']
export const SONIOX_WEBHOOK_HEADER = 'X-Hilm-Webhook-Token'

/** Soniox async list price: $1.50 / 1M audio tokens, $3.50 / 1M text tokens (~30k audio tokens/hour). */
const AUDIO_TOKENS_PER_HOUR = 30_000
const AUDIO_USD_PER_TOKEN = 1.5 / 1_000_000
const TEXT_USD_PER_TOKEN = 3.5 / 1_000_000
const TEXT_TOKENS_PER_CHAR = 0.3
const MAX_CONTEXT_CHARS = 9_000

export function sonioxReference(os: string, meetingId: string, window = 0) {
  return window > 0 ? `hilm:${os}:${meetingId}:w${window}` : `hilm:${os}:${meetingId}`
}

export type SonioxWindow<T extends SonioxAudioPart = SonioxAudioPart> = {
  index: number
  /** Contiguous parts; every window after the first starts with the previous window's last part. */
  parts: T[]
  audioMs: number
  /** Meeting-time range whose words this window owns: [keepFromMs, keepToMs). */
  keepFromMs: number
  keepToMs: number | null
  /** Start of the audio shared with the previous window (null for the first window). */
  overlapFromMs: number | null
}

/**
 * Split a meeting's parts into Soniox windows of at most `maxMs`. Consecutive windows share one
 * recorded part so no word is cut at the boundary; the boundary itself sits in the middle of that
 * shared part, and each window keeps only the words that start on its side of it.
 */
export function planSonioxWindows<T extends SonioxAudioPart>(parts: T[], maxMs = SONIOX_WINDOW_MAX_MS): SonioxWindow<T>[] {
  const ordered = [...parts].sort((a, b) => a.idx - b.idx)
  if (!ordered.length) return []
  const dur = (part: T) => Math.max(0, part.duration_ms)
  const ranges: Array<[number, number]> = []
  let start = 0
  for (;;) {
    let end = start
    let total = dur(ordered[start]!)
    while (end + 1 < ordered.length && total + dur(ordered[end + 1]!) <= maxMs) {
      end += 1
      total += dur(ordered[end]!)
    }
    // A window must reach past the shared part, even if one part alone exceeds the budget.
    if (end === start && end + 1 < ordered.length) end += 1
    ranges.push([start, end])
    if (end >= ordered.length - 1) break
    start = end
  }
  const boundaries = ranges.map(([from], i) => {
    if (i === 0) return 0
    const shared = ordered[from]!
    return shared.offset_ms + Math.round(dur(shared) / 2)
  })
  return ranges.map(([from, to], i) => {
    const windowParts = ordered.slice(from, to + 1)
    return {
      index: i,
      parts: windowParts,
      audioMs: windowParts.reduce((sum, part) => sum + dur(part), 0),
      keepFromMs: boundaries[i]!,
      keepToMs: i + 1 < ranges.length ? boundaries[i + 1]! : null,
      overlapFromMs: i === 0 ? null : ordered[from]!.offset_ms,
    }
  })
}

/** Maps a time on a window's joined-audio timeline onto the meeting timeline. */
export function windowTimeMapper(parts: SonioxAudioPart[]) {
  const ordered = [...parts].sort((a, b) => a.idx - b.idx)
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
  const toMeetingMs = (t: number, i = partAt(t)) => {
    const part = ordered[i]!
    const local = Math.min(Math.max(0, t - starts[i]!), Math.max(0, part.duration_ms))
    return part.offset_ms + local
  }
  return { ordered, partAt, toMeetingMs }
}

export type SpeakerLabeler = (raw: SonioxToken['speaker']) => string

/** Speaker numbers already used by labels like "Speaker 3". */
function usedSpeakerNumbers(labels: Iterable<string>) {
  const used = new Set<number>()
  for (const label of labels) {
    const match = /^Speaker (\d{1,3})$/.exec(label)
    if (match) used.add(Number(match[1]))
  }
  return used
}

const RECONCILE_MIN_TOKENS = 8
const RECONCILE_MIN_SHARE = 0.8

/**
 * Soniox speaker ids are scoped to one job. For a later window, a Soniox speaker keeps the label
 * of the previous window's speaker only when the shared overlap audio shows the same voice: at
 * least RECONCILE_MIN_TOKENS of its overlap words fall inside that speaker's lines and they make
 * up RECONCILE_MIN_SHARE of its overlap words. Anyone else gets a new "Speaker N" — an uncertain
 * match is never presented as the same person.
 */
export function reconcileWindowSpeakers(input: {
  tokens: SonioxToken[]
  parts: SonioxAudioPart[]
  overlapFromMs: number
  keepFromMs: number
  previousLines: Array<{ start_ms: number; end_ms: number; speakerLabel: string }>
  existingLabels: string[]
}): { label: SpeakerLabeler; matches: Map<string, string> } {
  const { toMeetingMs } = windowTimeMapper(input.parts)
  const votes = new Map<string, Map<string, number>>()
  const totals = new Map<string, number>()
  for (const token of input.tokens) {
    if (token.translation_status === 'translation' || !token.text.trim()) continue
    const t = toMeetingMs(token.start_ms)
    if (t < input.overlapFromMs || t >= input.keepFromMs) continue
    const speaker = speakerKey(token.speaker)
    totals.set(speaker, (totals.get(speaker) ?? 0) + 1)
    const line = input.previousLines.find((row) => t >= row.start_ms && t < Math.max(row.end_ms, row.start_ms + 1))
    if (!line) continue
    const forSpeaker = votes.get(speaker) ?? new Map<string, number>()
    forSpeaker.set(line.speakerLabel, (forSpeaker.get(line.speakerLabel) ?? 0) + 1)
    votes.set(speaker, forSpeaker)
  }
  const candidates: Array<{ speaker: string; label: string; count: number }> = []
  for (const [speaker, byLabel] of votes) {
    for (const [label, count] of byLabel) {
      if (count >= RECONCILE_MIN_TOKENS && count / (totals.get(speaker) ?? count) >= RECONCILE_MIN_SHARE) {
        candidates.push({ speaker, label, count })
      }
    }
  }
  candidates.sort((a, b) => b.count - a.count)
  const matches = new Map<string, string>()
  const claimed = new Set<string>()
  for (const candidate of candidates) {
    if (matches.has(candidate.speaker) || claimed.has(candidate.label)) continue
    matches.set(candidate.speaker, candidate.label)
    claimed.add(candidate.label)
  }

  const used = usedSpeakerNumbers(input.existingLabels)
  const assigned = new Map(matches)
  const label: SpeakerLabeler = (raw) => {
    const key = speakerKey(raw)
    const known = assigned.get(key)
    if (known) return known
    let n = 1
    while (used.has(n)) n += 1
    used.add(n)
    const fresh = `Speaker ${n}`
    assigned.set(key, fresh)
    return fresh
  }
  return { label, matches }
}

function speakerKey(raw: SonioxToken['speaker']) {
  return raw === null || raw === undefined || String(raw).trim() === '' ? '1' : String(raw).trim()
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
function speakerLabeler(): SpeakerLabeler {
  const assigned = new Map<string, string>()
  const used = new Set<number>()
  return (raw: SonioxToken['speaker']) => {
    const key = speakerKey(raw)
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
 * For a window of a long meeting, only words starting in [keepFromMs, keepToMs) are kept.
 */
export function sonioxTokensToLines(
  tokens: SonioxToken[],
  parts: SonioxAudioPart[],
  options: {
    keepFromMs?: number
    keepToMs?: number | null
    label?: SpeakerLabeler
    /** Later windows: lines starting in the shared first part are numbered after the earlier window's. */
    sharedFirstPart?: boolean
  } = {},
): SonioxLine[] {
  const { ordered, partAt, toMeetingMs } = windowTimeMapper(parts)
  if (!ordered.length) return []

  const label = options.label ?? speakerLabeler()
  const keepFrom = options.keepFromMs ?? Number.NEGATIVE_INFINITY
  const keepTo = options.keepToMs ?? Number.POSITIVE_INFINITY
  type Draft = { speaker: string; start: number; end: number; text: string; langChars: Map<string, number> }
  const drafts: Draft[] = []
  let current: Draft | null = null

  for (const token of tokens) {
    if (token.translation_status === 'translation') continue
    if (!token.text) continue
    const meetingStart = toMeetingMs(token.start_ms)
    if (meetingStart < keepFrom || meetingStart >= keepTo) continue
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
    const base = options.sharedFirstPart && i === 0 ? OVERLAP_ORDINAL_BASE : 0
    lines.push({
      audioSegmentId: part.id,
      speakerLabel: draft.speaker,
      start_ms: startMs,
      end_ms: endMs,
      text,
      language: meta.language,
      languages: meta.languages,
      ordinal: part.idx * MEETING_SEGMENT_ORDINAL_STRIDE + Math.min(base + n, MEETING_SEGMENT_ORDINAL_STRIDE - 1),
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
