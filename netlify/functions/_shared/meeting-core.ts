/** Pure meeting-intelligence helpers: prompts, response validation, stitching and sanitizing. */
import { z } from 'zod'

export type MeetingOs = 'personal' | 'workspace'

export const MEETING_AUTO_ATTEMPTS = 2
export const MEETING_TRANSCRIBE_MODEL = 'google/gemini-2.5-flash'
export const MEETING_AUDIO_PRICING_MODEL = 'google/gemini-2.5-flash:audio'
export const MEETING_SEGMENT_ORDINAL_STRIDE = 10_000
export const MEETING_MAX_TRANSCRIPT_CHARS = 400_000

export const SPEAKER_LABEL_RE = /^Speaker (\d{1,3})$/

export function meetingTables(os: MeetingOs) {
  const prefix = os === 'workspace' ? 'workspace_' : ''
  return {
    meetings: os === 'workspace' ? 'workspace_meetings' : 'meetings',
    speakers: `${prefix}meeting_speakers`,
    audio: `${prefix}meeting_audio_segments`,
    transcript: `${prefix}meeting_transcript_segments`,
    decisions: `${prefix}meeting_decisions`,
    actions: `${prefix}meeting_action_items`,
  } as const
}

// ── Transcription ───────────────────────────────────────────────────────────

const numberish = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const n = typeof value === 'number' ? value : parseClockOrSeconds(value)
  if (n === null || !Number.isFinite(n)) {
    ctx.addIssue({ code: 'custom', message: 'invalid time' })
    return z.NEVER
  }
  return n
})

export const transcriptionResponseSchema = z.object({
  segments: z
    .array(
      z.object({
        speaker: z.string().min(1).max(60),
        start: numberish,
        end: numberish.optional(),
        text: z.string(),
        language: z.string().max(12).optional().nullable(),
      }),
    )
    .max(1500),
  speakers: z
    .array(z.object({ label: z.string().min(1).max(60), description: z.string().max(240).optional().nullable() }))
    .max(40)
    .optional(),
})

export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>

export function parseClockOrSeconds(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  const parts = trimmed.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

export type RosterSpeaker = { id: string; label: string; description: string | null; display_name?: string | null }

export type StitchedSegment = {
  speakerLabel: string
  start_ms: number
  end_ms: number
  text: string
  language: string | null
  ordinal: number
}

/** Normalize model speaker names onto stable "Speaker N" labels. */
export function normalizeSpeakerLabel(raw: string, roster: RosterSpeaker[]): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/(\d{1,3})/)
  if (SPEAKER_LABEL_RE.test(trimmed)) return trimmed
  const byName = roster.find(
    (speaker) =>
      speaker.display_name && speaker.display_name.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  if (byName) return byName.label
  if (match) return `Speaker ${Number(match[1])}`
  return 'Speaker 1'
}

/**
 * Convert chunk-relative model output into meeting-absolute segments.
 * Drops empty text, clamps timestamps into the chunk, keeps order.
 */
export function stitchChunkSegments(input: {
  response: TranscriptionResponse
  chunkIdx: number
  offsetMs: number
  durationMs: number
  roster: RosterSpeaker[]
}): StitchedSegment[] {
  const { response, chunkIdx, offsetMs, durationMs, roster } = input
  const maxMs = Math.max(0, durationMs)
  const out: StitchedSegment[] = []
  let previousStart = 0
  for (const segment of response.segments) {
    const text = segment.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    let startLocal = Math.round(Math.max(0, segment.start) * 1000)
    if (maxMs > 0) startLocal = Math.min(startLocal, maxMs)
    if (startLocal < previousStart) startLocal = previousStart
    let endLocal =
      segment.end !== undefined ? Math.round(Math.max(0, segment.end) * 1000) : startLocal
    if (maxMs > 0) endLocal = Math.min(endLocal, maxMs)
    if (endLocal < startLocal) endLocal = startLocal
    previousStart = startLocal
    out.push({
      speakerLabel: normalizeSpeakerLabel(segment.speaker, roster),
      start_ms: offsetMs + startLocal,
      end_ms: offsetMs + endLocal,
      text,
      language: segment.language?.trim() || null,
      ordinal: chunkIdx * MEETING_SEGMENT_ORDINAL_STRIDE + out.length,
    })
  }
  return out
}

export function buildTranscriptionPrompt(input: {
  roster: RosterSpeaker[]
  previousLines: Array<{ label: string; text: string }>
  languageHint: string | null
  chunkIdx: number
}) {
  const rosterText = input.roster.length
    ? input.roster
        .map((speaker) => `- ${speaker.label}${speaker.description ? `: ${speaker.description}` : ''}`)
        .join('\n')
    : '(none yet — this is the first part of the meeting)'
  const previous = input.previousLines.length
    ? input.previousLines.map((line) => `${line.label}: ${line.text}`).join('\n')
    : '(no earlier transcript)'

  return `You are a precise meeting transcriber. Transcribe the attached audio, which is part ${input.chunkIdx + 1} of a longer meeting recording.

Rules:
- Transcribe exactly what is said, in the language actually spoken. Arabic stays in Arabic script, English in English. Mixed-language speech stays mixed. Do NOT translate.
- Keep names, product names and acronyms as spoken (e.g. "iMED", "Hilm"). Do not "correct" them into other words.
- Add natural punctuation and sentence boundaries. Do not summarize, paraphrase or skip content. Do not invent words for inaudible parts; omit them.
- Keep genuinely repeated words if they were actually said.
- Split into segments at speaker changes and natural pauses (max ~30 seconds per segment).
- Label speakers as "Speaker 1", "Speaker 2", ... Reuse the existing labels below when the voice matches; add a new number only for a clearly new voice. Never guess real names.
- If there is no speech, return an empty "segments" array.
- "start"/"end" are seconds from the beginning of THIS audio part.
- "language" is a short code such as "en" or "ar".
${input.languageHint ? `- The user's interface language is "${input.languageHint}" (a hint only).` : ''}

Known speakers so far:
${rosterText}

End of the previous part (for continuity only, do not repeat it):
${previous}

Return ONLY JSON:
{"segments":[{"speaker":"Speaker 1","start":0.0,"end":4.2,"text":"...","language":"en"}],"speakers":[{"label":"Speaker 1","description":"short neutral cue, e.g. leads the meeting, discusses API"}]}`
}

// ── Analysis ────────────────────────────────────────────────────────────────

const certaintyDecision = z.enum(['confirmed', 'uncertain']).catch('uncertain')
const certaintyAction = z.enum(['confirmed', 'possible']).catch('possible')
const ownerCertainty = z.enum(['confirmed', 'uncertain', 'none']).catch('none')
const priorityValue = z.enum(['none', 'low', 'medium', 'high', 'urgent']).nullable().catch(null)
const sourceRefs = z.array(z.union([z.number(), z.string()])).max(40).catch([])

export const analysisResponseSchema = z.object({
  language: z.string().max(12).nullable().optional().catch(null),
  summary: z.string().max(6000).catch(''),
  key_points: z.array(z.string().max(600)).max(30).catch([]),
  decisions: z
    .array(
      z.object({
        text: z.string().min(1).max(600),
        certainty: certaintyDecision,
        sources: sourceRefs.optional(),
      }),
    )
    .max(40)
    .catch([]),
  action_items: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        description: z.string().max(1500).nullable().optional(),
        owner: z.string().max(80).nullable().optional(),
        owner_certainty: ownerCertainty.optional(),
        due_text: z.string().max(120).nullable().optional(),
        due_date: z.string().max(20).nullable().optional(),
        priority: priorityValue.optional(),
        certainty: certaintyAction,
        sources: sourceRefs.optional(),
      }),
    )
    .max(60)
    .catch([]),
})

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>

export type AnalysisLine = { ref: number; segmentId: string; speakerLabel: string; startMs: number; text: string }

export type SanitizedDecision = { text: string; certainty: 'confirmed' | 'uncertain'; source_segment_ids: string[] }
export type SanitizedActionItem = {
  title: string
  description: string | null
  ownerLabel: string | null
  owner_certainty: 'confirmed' | 'uncertain' | 'none'
  due_text: string | null
  due_date: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent' | null
  certainty: 'confirmed' | 'possible'
  source_segment_ids: string[]
}

export type SanitizedAnalysis = {
  language: string | null
  summary: string
  key_points: string[]
  decisions: SanitizedDecision[]
  action_items: SanitizedActionItem[]
}

function mapRefs(refs: Array<number | string> | undefined, lines: AnalysisLine[]) {
  if (!refs?.length) return []
  const byRef = new Map(lines.map((line) => [line.ref, line.segmentId]))
  const ids = new Set<string>()
  for (const ref of refs) {
    const n = typeof ref === 'number' ? ref : Number(String(ref).replace(/[^\d]/g, ''))
    const id = byRef.get(n)
    if (id) ids.add(id)
  }
  return [...ids]
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * Enforce "facts vs inferences": owners only from the roster, due dates only when the
 * transcript stated a deadline, invented source references dropped, unsupported confirmations downgraded.
 */
export function sanitizeAnalysis(
  raw: AnalysisResponse,
  context: { lines: AnalysisLine[]; rosterLabels: string[]; displayNames?: Record<string, string> },
): SanitizedAnalysis {
  const roster = new Set(context.rosterLabels)
  const nameToLabel = new Map<string, string>()
  for (const [label, name] of Object.entries(context.displayNames ?? {})) {
    if (name.trim()) nameToLabel.set(name.trim().toLowerCase(), label)
  }

  const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()

  const decisions: SanitizedDecision[] = []
  for (const decision of raw.decisions) {
    const text = clean(decision.text)
    if (!text) continue
    const sources = mapRefs(decision.sources, context.lines)
    decisions.push({
      text,
      certainty: sources.length ? decision.certainty : 'uncertain',
      source_segment_ids: sources,
    })
  }

  const seenTitles = new Set<string>()
  const actionItems: SanitizedActionItem[] = []
  for (const item of raw.action_items) {
    const title = clean(item.title)
    if (!title) continue
    const key = title.toLowerCase()
    if (seenTitles.has(key)) continue
    seenTitles.add(key)

    const sources = mapRefs(item.sources, context.lines)
    let ownerLabel: string | null = null
    const ownerRaw = clean(item.owner)
    if (ownerRaw) {
      if (roster.has(ownerRaw)) ownerLabel = ownerRaw
      else if (nameToLabel.has(ownerRaw.toLowerCase())) ownerLabel = nameToLabel.get(ownerRaw.toLowerCase())!
      else {
        const numbered = ownerRaw.match(/^speaker\s*(\d{1,3})$/i)
        if (numbered && roster.has(`Speaker ${Number(numbered[1])}`)) ownerLabel = `Speaker ${Number(numbered[1])}`
      }
    }
    let ownerCert: SanitizedActionItem['owner_certainty'] = ownerLabel
      ? item.owner_certainty === 'confirmed'
        ? 'confirmed'
        : 'uncertain'
      : 'none'
    if (ownerLabel && !sources.length) ownerCert = 'uncertain'

    const dueText = clean(item.due_text) || null
    const dueDateRaw = clean(item.due_date)
    const dueDate = dueText && dueDateRaw && isIsoDate(dueDateRaw) ? dueDateRaw : null

    actionItems.push({
      title: title.slice(0, 300),
      description: clean(item.description) || null,
      ownerLabel,
      owner_certainty: ownerCert,
      due_text: dueText,
      due_date: dueDate,
      priority: item.priority ?? null,
      certainty: sources.length ? item.certainty : 'possible',
      source_segment_ids: sources,
    })
  }

  return {
    language: clean(raw.language) || null,
    summary: clean(raw.summary),
    key_points: raw.key_points.map(clean).filter(Boolean),
    decisions,
    action_items: actionItems,
  }
}

export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function buildAnalysisTranscript(lines: AnalysisLine[], maxChars = MEETING_MAX_TRANSCRIPT_CHARS) {
  const parts: string[] = []
  let size = 0
  for (const line of lines) {
    const row = `[#${line.ref}] (${formatClock(line.startMs)}) ${line.speakerLabel}: ${line.text}`
    size += row.length + 1
    if (size > maxChars) break
    parts.push(row)
  }
  return parts.join('\n')
}

export function buildAnalysisPrompt(input: {
  title: string
  meetingDate: string | null
  projectName: string | null
  roster: Array<{ label: string; display_name: string | null }>
  locale: 'en' | 'ar'
}) {
  const roster = input.roster
    .map((speaker) => `- ${speaker.label}${speaker.display_name ? ` (named "${speaker.display_name}" by the user)` : ''}`)
    .join('\n')
  return `You are Hilm's meeting analyst. Analyse the meeting transcript and return structured JSON.

Meeting: "${input.title}"${input.projectName ? ` — project "${input.projectName}"` : ''}
Meeting date: ${input.meetingDate ?? 'unknown'}
Speakers:
${roster || '- (unknown)'}

STRICT RULES — facts vs inferences:
- Only use what is in the transcript. Never fabricate decisions, attendees, owners, deadlines or commitments.
- "decisions": only things the group explicitly agreed or decided. If it sounds tentative, set certainty "uncertain".
- "action_items": concrete follow-ups. certainty "confirmed" only when someone explicitly committed ("I'll do X", "Rakan will do Y"). Otherwise "possible".
- "owner": exactly one speaker label from the list above (or null). owner_certainty "confirmed" only if that speaker explicitly took it on; "uncertain" if implied; null owner + "none" if unknown.
- "due_text": the deadline words exactly as said (e.g. "by Thursday", "tomorrow"), or null if no deadline was stated. "due_date": resolve due_text to YYYY-MM-DD relative to the meeting date ONLY when due_text is non-null; else null.
- "priority": only if clearly implied (e.g. "urgent", "top priority"); else null.
- "sources": the [#n] reference numbers of the transcript lines that support each item.
- Write summary, key points, decisions and action items in the meeting's dominant language${
    input.locale === 'ar' ? ' (prefer Arabic if the meeting is mixed Arabic/English)' : ''
  }. Keep names and acronyms as spoken.
- "language": dominant language code, e.g. "en" or "ar".

Return ONLY JSON:
{"language":"en","summary":"3-6 sentence summary","key_points":["..."],"decisions":[{"text":"...","certainty":"confirmed","sources":[3,4]}],"action_items":[{"title":"short imperative task title","description":"context from the meeting","owner":"Speaker 2","owner_certainty":"confirmed","due_text":"tomorrow","due_date":"2026-01-02","priority":null,"certainty":"confirmed","sources":[7]}]}`
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] ?? text).trim()
  const tryParse = (value: string) => {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  const direct = tryParse(raw)
  if (direct) return direct
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return tryParse(raw.slice(start, end + 1))
  return null
}

/** Friendly, non-leaky error codes for the client. */
export function friendlyMeetingError(code: string) {
  switch (code) {
    case 'provider_timeout':
      return 'Transcription took too long. It will be retried.'
    case 'provider_error':
      return 'The AI service could not process this part of the recording.'
    case 'parse_error':
      return 'The AI returned an unreadable result.'
    case 'audio_missing':
      return 'The audio for this part of the recording could not be found.'
    default:
      return 'Processing failed.'
  }
}
