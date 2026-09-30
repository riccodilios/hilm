/** Pure meeting-intelligence helpers: prompts, response validation, stitching and sanitizing. */
import { z } from 'zod'

export type MeetingOs = 'personal' | 'workspace'

/**
 * Per-segment automatic STT attempts before the meeting is marked failed.
 * Kept modest so flaky provider calls cannot multiply OpenRouter spend.
 */
export const MEETING_AUTO_ATTEMPTS = 3
export const MEETING_TRANSCRIBE_MODEL = 'google/gemini-2.5-flash'
export const MEETING_AUDIO_PRICING_MODEL = 'google/gemini-2.5-flash:audio'
/** Gemini audio input rate, confirmed by provider-reported prompt_tokens_details.audio_tokens. */
export const MEETING_AUDIO_TOKENS_PER_SECOND = 25
export const MEETING_SEGMENT_ORDINAL_STRIDE = 10_000
export const MEETING_MAX_TRANSCRIPT_CHARS = 400_000
/** Always-on STT hint terms (the project name is added per meeting). */
export const MEETING_DEFAULT_VOCABULARY = [
  'Hilm',
  'Visma',
  'Milkman',
  'iMED',
  'API',
  'Supabase',
  'Netlify',
  'GitHub',
  'Oracle',
  'CRM',
  'ERP',
]

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

/**
 * Normalize provider language tags for storage.
 * Accepts BCP-47-ish codes (`en`, `ar`, `ar-SA`, `ar-LB`), `mixed`, and common dialect labels.
 * Returns null when the provider did not supply a usable code — never invent one.
 */
export function normalizeLanguageCode(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase().replace(/_/g, '-')

  if (lower === 'mixed' || lower === 'multilingual' || lower === 'code-switch' || lower === 'code-switching') {
    return 'mixed'
  }

  const dialectMap: Record<string, string> = {
    arabic: 'ar',
    'modern standard arabic': 'ar',
    msa: 'ar',
    fusha: 'ar',
    'saudi arabic': 'ar-SA',
    saudi: 'ar-SA',
    najdi: 'ar-SA',
    hijazi: 'ar-SA',
    'gulf arabic': 'ar-AE',
    gulf: 'ar-AE',
    khaleeji: 'ar-AE',
    'lebanese arabic': 'ar-LB',
    lebanese: 'ar-LB',
    levant: 'ar-LB',
    levantine: 'ar-LB',
    syrian: 'ar-SY',
    jordanian: 'ar-JO',
    palestinian: 'ar-PS',
    'egyptian arabic': 'ar-EG',
    egyptian: 'ar-EG',
    masri: 'ar-EG',
    english: 'en',
    'american english': 'en-US',
    'british english': 'en-GB',
  }
  if (dialectMap[lower]) return dialectMap[lower]!

  // Keep short BCP-47 tags; clamp long free-text so one bad field cannot fail the chunk.
  const bcp47 = lower.match(/^([a-z]{2,3})(?:-([a-z0-9]{2,8}))?/)
  if (bcp47) {
    const primary = bcp47[1]!
    const region = bcp47[2]
    if (region) return `${primary}-${region.toUpperCase()}`
    return primary
  }
  return lower.slice(0, 12)
}

const languageCodeField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => normalizeLanguageCode(typeof value === 'string' ? value : null))

/** Script-based language list for metadata only — never rewrites transcript text. */
export function inferSpokenLanguages(text: string): string[] {
  const arabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text)
  const latin = /[A-Za-z]/.test(text)
  if (arabic && latin) return ['ar', 'en']
  if (arabic) return ['ar']
  if (latin) return ['en']
  return []
}

function primaryLanguageCode(code: string): string {
  if (code === 'mixed') return 'mixed'
  return code.split('-')[0] || code
}

export function resolveSegmentLanguageMeta(input: {
  language?: string | null
  languages?: Array<string | null | undefined> | null
  text: string
}): { language: string | null; languages: string[] } {
  const fromModel = (input.languages ?? [])
    .map((value) => normalizeLanguageCode(value))
    .filter((value): value is string => Boolean(value))
  const inferred = inferSpokenLanguages(input.text)
  let language = normalizeLanguageCode(input.language)
  // Merge model tags + script evidence; store primary codes (ar/en) in languages[].
  const languages = [
    ...new Set(
      [...fromModel, ...inferred, ...(language && language !== 'mixed' ? [language] : [])]
        .map(primaryLanguageCode)
        .filter((code) => code !== 'mixed'),
    ),
  ]
  if (languages.length > 1) language = 'mixed'
  else if (!language && languages.length === 1) language = languages[0]!
  return { language, languages }
}

const languageListField = z
  .array(z.union([z.string(), z.null(), z.undefined()]))
  .max(8)
  .optional()
  .nullable()
  .transform((value) => {
    if (!value) return [] as string[]
    return [
      ...new Set(
        value
          .map((entry) => normalizeLanguageCode(entry))
          .filter((entry): entry is string => Boolean(entry)),
      ),
    ]
  })

export const transcriptionResponseSchema = z.object({
  segments: z
    .array(
      z.object({
        speaker: z.string().min(1).max(60),
        start: numberish,
        end: numberish.optional(),
        text: z.string(),
        /** Detected spoken language for this segment (e.g. en, ar, ar-SA, mixed). Optional. */
        language: languageCodeField.optional(),
        /** Languages present in this segment when code-switching. Optional. */
        languages: languageListField,
        confidence: z.union([z.number(), z.string()]).optional().nullable().transform((value) => {
          if (value == null || value === '') return null
          const n = typeof value === 'number' ? value : Number(value)
          return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null
        }),
      }),
    )
    .max(1500),
  speakers: z
    .array(z.object({ label: z.string().min(1).max(60), description: z.string().max(240).optional().nullable() }))
    .max(40)
    .optional(),
})

export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>

/**
 * Compact STT reply: `{"s":[[speaker,start,end,"text"],...],"n":{"2":"voice cue"},"l":"ar-SA"}`.
 * Per-segment language/languages are derived from the text's script (plus `l` for the dialect),
 * so the model does not spend output tokens on them; timestamps and speakers stay model-provided.
 */
const compactRowSchema = z.array(z.union([z.string(), z.number(), z.null()])).min(3).max(6)

export const compactTranscriptionSchema = z.object({
  // Rows are validated one by one in fromCompactTranscription so one odd row cannot drop the part.
  s: z.array(z.unknown()).max(1500),
  n: z.record(z.string(), z.unknown()).optional().nullable().catch(null),
  l: z.string().max(40).optional().nullable().catch(null),
})

function compactTime(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return parseClockOrSeconds(value)
  return null
}

function compactSpeaker(value: string | number | null | undefined): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1000) return `Speaker ${value}`
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim().slice(0, 60)
    return /^\d{1,3}$/.test(trimmed) ? `Speaker ${Number(trimmed)}` : trimmed
  }
  return null
}

type TranscriptionSegment = TranscriptionResponse['segments'][number]

function compactRowToSegment(row: Array<string | number | null>, chunkLanguage: string | null): TranscriptionSegment | null {
  const speaker = compactSpeaker(row[0])
  const start = compactTime(row[1])
  if (!speaker || start === null) return null
  let end: number | undefined
  let text: string | null = null
  if (typeof row[3] === 'string') {
    end = compactTime(row[2]) ?? undefined
    text = row[3]
  } else if (typeof row[2] === 'string' && compactTime(row[2]) === null) {
    text = row[2]
  }
  if (text === null) return null
  const scripts = inferSpokenLanguages(text)
  // The chunk tag only refines Arabic-only lines to a dialect (ar-SA, ar-EG, ...).
  const language = chunkLanguage?.startsWith('ar-') && scripts.length === 1 && scripts[0] === 'ar' ? chunkLanguage : null
  return { speaker, start, end, text, language, languages: [], confidence: null }
}

/** Gemini sometimes wraps rows in an extra array (`[[1,0,2,"x"]]`); unwrap to plain rows. */
function flattenCompactRows(items: unknown[], depth = 0): unknown[] {
  const rows: unknown[] = []
  for (const item of items) {
    if (depth < 3 && Array.isArray(item) && item.length && item.every(Array.isArray)) {
      rows.push(...flattenCompactRows(item, depth + 1))
    } else {
      rows.push(item)
    }
  }
  return rows
}

export function fromCompactTranscription(data: z.infer<typeof compactTranscriptionSchema>): TranscriptionResponse {
  const chunkLanguage = normalizeLanguageCode(data.l ?? null)
  const segments = flattenCompactRows(data.s)
    .slice(0, 1500)
    .map((raw) => {
      const row = compactRowSchema.safeParse(raw)
      return row.success ? compactRowToSegment(row.data, chunkLanguage) : null
    })
    .filter((segment): segment is TranscriptionSegment => segment !== null)
  const speakers = Object.entries(data.n ?? {})
    .map(([key, description]) => ({
      label: compactSpeaker(key),
      description: typeof description === 'string' ? description.trim().slice(0, 240) || null : null,
    }))
    .filter((speaker): speaker is { label: string; description: string | null } => Boolean(speaker.label))
    .slice(0, 40)
  return { segments, speakers }
}

/** Accepts the compact reply and the legacy `{"segments":[{...}]}` reply. */
export function parseTranscriptionJson(json: Record<string, unknown>): TranscriptionResponse | null {
  if (Array.isArray(json.s)) {
    const compact = compactTranscriptionSchema.safeParse(json)
    return compact.success ? fromCompactTranscription(compact.data) : null
  }
  const legacy = transcriptionResponseSchema.safeParse(json)
  return legacy.success ? legacy.data : null
}

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
  languages: string[]
  confidence: number | null
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
    const meta = resolveSegmentLanguageMeta({
      language: segment.language,
      languages: segment.languages,
      text,
    })
    out.push({
      speakerLabel: normalizeSpeakerLabel(segment.speaker, roster),
      start_ms: offsetMs + startLocal,
      end_ms: offsetMs + endLocal,
      text,
      language: meta.language,
      languages: meta.languages,
      confidence: segment.confidence ?? null,
      ordinal: chunkIdx * MEETING_SEGMENT_ORDINAL_STRIDE + out.length,
    })
  }
  return out
}

/**
 * Fixed instructions, identical for every part, so they form a stable prompt prefix. The
 * per-part context (hints, roster, previous lines) follows in buildTranscriptionPrompt.
 */
export const TRANSCRIPTION_INSTRUCTIONS = `Transcribe this meeting audio verbatim. This is transcription, not translation.

LANGUAGE
- Write every word in the language and script it was spoken. Never translate Arabic↔English, never write English words in Arabic letters ("today", not "توداي"), never turn dialect into MSA, never paraphrase or clean up.
- Decide the language per segment from this audio only. Earlier parts, the UI language or the dominant language must not decide it. Speakers may use different languages and switch mid-sentence.
- Keep mixed speech mixed: "خلينا نراجع the API integration وبعدها نرسل التقرير." / "Okay خلينا نبدأ. أول شيء we need to check the database."
- English said with an Arabic accent or inside an Arabic sentence is still English in Latin letters. Good: "بكرة we deploy to production". Bad: "بكرة وي ديبلوي تو برودكشن".
- Arabic dialects (Saudi, Gulf, Levantine, Egyptian, MSA, informal) are written as spoken; a dialect never turns English words into Arabic letters.

NAMES AND TERMS
- Keep English names, companies, products and technical terms (API, backend, database, deployment, production, testing) in Latin script, even inside Arabic sentences: "الشركة تستخدم Visma في المحاسبة."
- Write a name as heard. Never drop it, never replace it with a different or "related" entity. Hint terms help recognition only; never insert one that was not said.

SPEECH
- Keep fillers, repetitions, self-corrections and cut-off sentences. Omit inaudible parts; never invent words. Natural punctuation only.
- Silence, noise or music is not speech: output no segment for it and never repeat a line to fill time.

SEGMENTS AND SPEAKERS
- Start a new segment at each speaker change or natural pause, at most ~30 s each.
- Speakers are numbers 1, 2, 3… Tell voices apart by pitch, gender and tone. Reuse a known speaker's number when the voice matches; use the next number only for a clearly new voice. Never guess real names.
- Times are seconds from the start of this audio.

OUTPUT: only this JSON, keys in this order.
{"n":{"speaker":"short neutral voice cue"},"s":[[speaker,start,end,"text"]],"l":"language tag"}
- "n": every speaker heard in this audio with a short voice cue.
- "s": segments in order; [] when there is no speech.
- "l": dominant language of this audio after transcribing it: en, ar, a dialect tag (ar-SA, ar-EG, ar-LB, ar-AE…) or mixed. It never changes the text.
Example: {"n":{"1":"higher female voice","2":"calm lower male voice"},"s":[[1,0.0,4.2,"مرحبا، today we're going to discuss the new system."],[2,4.6,6.1,"Sounds good."]],"l":"mixed"}`

function speakerNumber(label: string) {
  const match = label.match(SPEAKER_LABEL_RE)
  return match ? match[1]! : label
}

export function buildTranscriptionPrompt(input: {
  roster: RosterSpeaker[]
  previousLines: Array<{ label: string; text: string }>
  chunkIdx: number
  vocabulary?: string[]
}) {
  const vocabulary = [...new Set((input.vocabulary ?? []).map((term) => term.trim()).filter(Boolean))].slice(0, 40)
  const roster = input.roster.length
    ? input.roster
        .map((speaker) => `${speakerNumber(speaker.label)}${speaker.description ? ` = ${speaker.description}` : ''}`)
        .join('; ')
    : 'none yet'
  const previous = input.previousLines.length
    ? input.previousLines.map((line) => `- speaker ${speakerNumber(line.label)} said "${line.text}"`).join('\n')
    : ''

  return `${TRANSCRIPTION_INSTRUCTIONS}

PART ${input.chunkIdx + 1} CONTEXT
Hint terms: ${vocabulary.length ? vocabulary.join(', ') : 'none'}
Known speakers: ${roster}${
    previous
      ? `\nAlready transcribed at the end of the previous part. It is NOT in this audio: never output it again and do not copy its language. Use it only to keep speaker numbers consistent:\n${previous}`
      : ''
  }`
}

// ── Analysis ────────────────────────────────────────────────────────────────

const certaintyDecision = z.enum(['confirmed', 'uncertain']).catch('uncertain')
const certaintyAction = z.enum(['confirmed', 'possible']).catch('possible')
const ownerCertainty = z.enum(['confirmed', 'uncertain', 'none']).catch('none')
const priorityValue = z.enum(['none', 'low', 'medium', 'high', 'urgent']).nullable().catch(null)
const sourceRefs = z.array(z.union([z.number(), z.string()])).max(40).catch([])

export const analysisResponseSchema = z.object({
  language: languageCodeField.optional().catch(null),
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
        const numbered = ownerRaw.match(/^(?:speaker|s)\s*(\d{1,3})$/i)
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

/** "Speaker 3" → "S3" in analysis input; the sanitizer maps "S3" back to the roster label. */
export function analysisSpeakerTag(label: string) {
  const match = label.match(SPEAKER_LABEL_RE)
  return match ? `S${match[1]}` : label
}

/**
 * One line per transcript segment: `#ref S<n>: text`. Clock times are left out — analysis
 * never outputs times and cites lines by ref, which the sanitizer maps back to segment ids.
 */
export function buildAnalysisTranscript(lines: AnalysisLine[], maxChars = MEETING_MAX_TRANSCRIPT_CHARS) {
  const parts: string[] = []
  let size = 0
  for (const line of lines) {
    const row = `#${line.ref} ${analysisSpeakerTag(line.speakerLabel)}: ${line.text}`
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
  timeZone?: string | null
}) {
  const roster = input.roster
    .map((speaker) => `${analysisSpeakerTag(speaker.label)}${speaker.display_name ? ` (named "${speaker.display_name}" by the user)` : ''}`)
    .join('; ')
  const uiLang = input.locale === 'ar' ? 'Arabic' : 'English'
  const tz = input.timeZone?.trim() || 'UTC'
  return `${ANALYSIS_INSTRUCTIONS}

MEETING
Title: "${input.title}"${input.projectName ? ` — project "${input.projectName}"` : ''}
Date: ${input.meetingDate ?? 'unknown'} (timezone ${tz} for relative dates)
User's UI language: ${uiLang}
Speakers: ${roster || 'unknown'}`
}

/** Fixed analysis rules (stable prefix); meeting details follow in buildAnalysisPrompt. */
export const ANALYSIS_INSTRUCTIONS = `You are Hilm's multilingual meeting analyst. Return structured JSON about the transcript. Transcript lines are "#ref S<n>: text"; S<n> is the speaker.

LANGUAGE
- Write summary, key_points, decisions and action items in the meeting's dominant language (Arabic, English or mixed). For a mixed Arabic+English meeting with an Arabic UI, write Arabic. A clearly English meeting stays English even with an Arabic UI.
- Keep English technical terms, names and brands in Latin script (API, backend, deployment, testing, Visma, Milkman). Never transliterate them into Arabic or replace them with another company/product.
- Paraphrase dialect meaning in the analysis language; do not invent MSA quotes, do not translate the whole meeting into English. Never rewrite or "correct" the transcript.
- Action titles prefer the language the commitment was spoken in.

EXTRACTION
- Capture commitments in English, Arabic, dialect or mixed speech, e.g. "محمد، please finish the API integration by Thursday." / "خلّي أحمد يخلص الـ testing بكرا." / "I'll handle the backend and you can do the frontend."
- Owners may be Arabic or English names: map a name to the speaker the user named, otherwise use the speaker tag (S2).
- Resolve relative dates against the meeting date and timezone, including colloquial Arabic (اليوم، بكرا، بكرة، بعد بكرا، الأسبوع الجاي، نهاية الأسبوع، يوم الأحد، الخميس الجاي، بعد أسبوع، الشهر الجاي، الساعة ٣، الساعة ثلاثة ونص) and English (today, tomorrow, Thursday, end of week, next sprint).
- due_text: the deadline words exactly as said. due_date: YYYY-MM-DD only when clearly resolvable, else null. Never invent dates.

FACTS ONLY
- Use only the transcript. Never fabricate decisions, attendees, owners, deadlines or commitments.
- decisions: only what the group explicitly agreed; tentative → certainty "uncertain".
- action_items: concrete follow-ups; certainty "confirmed" only when someone explicitly committed, else "possible".
- owner: one speaker tag or null. owner_certainty "confirmed" only if that speaker explicitly took it on, "uncertain" if implied, "none" with a null owner if unknown.
- priority only if clearly implied, else null. sources: the #ref numbers supporting each item. language: dominant code (en, ar, ar-SA…).

Return ONLY JSON:
{"language":"ar","summary":"3-6 sentence summary","key_points":["..."],"decisions":[{"text":"...","certainty":"confirmed","sources":[3,4]}],"action_items":[{"title":"short imperative task title","description":"context from the meeting","owner":"S2","owner_certainty":"confirmed","due_text":"بكرا","due_date":"2026-01-02","priority":null,"certainty":"confirmed","sources":[7]}]}`

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

const transcriptionSegmentSchema = transcriptionResponseSchema.shape.segments.element

/**
 * Collapses a phrase the model repeated back-to-back (a known Gemini audio failure
 * mode) down to one occurrence. Real speech rarely repeats a 4+ word run 4+ times.
 */
export function collapseRepeatedPhrases(text: string): string {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 16) return text
  const norm = words.map((word) => word.toLowerCase().replace(/\p{P}/gu, ''))
  const sameRun = (a: number, b: number, len: number) => {
    for (let k = 0; k < len; k++) if (norm[a + k] !== norm[b + k]) return false
    return true
  }
  const out: string[] = []
  let changed = false
  let i = 0
  scan: while (i < words.length) {
    for (let len = 4; len <= 16 && i + len * 4 <= words.length; len++) {
      let reps = 1
      while (i + (reps + 1) * len <= words.length && sameRun(i, i + reps * len, len)) reps++
      if (reps >= 4) {
        out.push(...words.slice(i, i + len))
        i += reps * len
        changed = true
        continue scan
      }
    }
    out.push(words[i]!)
    i++
  }
  return changed ? out.join(' ') : text
}

/**
 * Removes runaway repetition from a transcription: phrase loops inside a segment, and
 * runs of 4+ consecutive segments with identical text (kept once). Shorter runs are left
 * alone — people do repeat themselves two or three times.
 */
export function dedupeTranscriptionLoops(response: TranscriptionResponse): TranscriptionResponse {
  const cleaned = response.segments.map((segment) => {
    const text = collapseRepeatedPhrases(segment.text)
    return text === segment.text ? segment : { ...segment, text }
  })
  const keyOf = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()
  const segments: TranscriptionResponse['segments'] = []
  for (let i = 0; i < cleaned.length; ) {
    const key = keyOf(cleaned[i]!.text)
    let run = 1
    while (i + run < cleaned.length && keyOf(cleaned[i + run]!.text) === key) run++
    const isLoop = run >= 4 && key.split(' ').length >= 3
    segments.push(...(isLoop ? [cleaned[i]!] : cleaned.slice(i, i + run)))
    i += run
  }
  return { ...response, segments }
}

/** Yields each complete JSON value (object or array) inside the array that opens at `from`. */
function* completeArrayItems(text: string, from: number, open: '{' | '[') {
  const close = open === '{' ? '}' : ']'
  let i = from
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i++
    if (i >= text.length) return
    if (text[i] === ']') {
      // End of the array — unless a stray `]` is followed by more items (seen from Gemini).
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j++
      if (text[j] !== ',') return
      let k = j + 1
      while (k < text.length && /\s/.test(text[k]!)) k++
      if (text[k] !== open) return
      i = k
    }
    if (text[i] !== open) {
      // Stray non-JSON text between items (seen from Gemini): skip to the next item.
      const next = text.indexOf(open, i)
      if (next < 0) return
      i = next
    }
    const start = i
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === open) depth++
      else if (ch === close && --depth === 0) {
        end = i
        break
      }
    }
    if (end < 0) return
    i = end + 1
    yield text.slice(start, end + 1)
  }
}

/**
 * Recovers the complete segments from a transcription JSON reply that was cut off
 * mid-output (max_tokens), in either the compact or the legacy format.
 * Returns null when nothing usable can be recovered.
 */
export function salvageTruncatedTranscription(text: string): TranscriptionResponse | null {
  const segments: TranscriptionResponse['segments'] = []
  const compactAt = text.search(/"s"\s*:\s*\[/)
  if (compactAt >= 0) {
    const language = text.match(/"l"\s*:\s*"([^"]{1,40})"/)?.[1] ?? null
    const chunkLanguage = normalizeLanguageCode(language)
    for (const raw of completeArrayItems(text, text.indexOf('[', compactAt) + 1, '[')) {
      try {
        for (const item of flattenCompactRows([JSON.parse(raw)])) {
          const row = compactRowSchema.safeParse(item)
          const segment = row.success ? compactRowToSegment(row.data, chunkLanguage) : null
          if (segment) segments.push(segment)
        }
      } catch {
        // skip a malformed row, keep the rest
      }
      if (segments.length >= 1500) break
    }
    return segments.length ? { segments } : null
  }
  const legacyAt = text.search(/"segments"\s*:\s*\[/)
  if (legacyAt < 0) return null
  for (const raw of completeArrayItems(text, text.indexOf('[', legacyAt) + 1, '{')) {
    try {
      const parsed = transcriptionSegmentSchema.safeParse(JSON.parse(raw))
      if (parsed.success) segments.push(parsed.data)
    } catch {
      // skip a malformed object, keep the rest
    }
    if (segments.length >= 1500) break
  }
  return segments.length ? { segments } : null
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
    case 'output_truncated':
      return 'This part of the recording was too long to transcribe in one go.'
    case 'audio_missing':
      return 'The audio for this part of the recording could not be found.'
    case 'disabled':
      return 'Meeting AI is temporarily disabled. Please try again later.'
    case 'rate_limited':
      return "You've reached your AI usage limit. Please wait and try again."
    case 'ai_limit':
      return "You've reached your AI usage limit for today."
    case 'global_cost_limit':
      return 'Meeting AI is paused for today because the service budget was reached. Your audio is safe — retry tomorrow.'
    case 'save_error':
      return 'Transcript could not be saved. Your audio is safe — retry processing.'
    case 'segment_failed':
      return 'Part of the recording could not be transcribed. Retry processing.'
    default:
      return 'Processing failed. Your audio is safe — retry processing.'
  }
}
