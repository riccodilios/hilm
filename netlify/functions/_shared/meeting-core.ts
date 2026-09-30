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

export function buildTranscriptionPrompt(input: {
  roster: RosterSpeaker[]
  previousLines: Array<{ label: string; text: string }>
  chunkIdx: number
  vocabulary?: string[]
}) {
  const rosterText = input.roster.length
    ? input.roster
        .map((speaker) => `- ${speaker.label}${speaker.description ? `: ${speaker.description}` : ''}`)
        .join('\n')
    : '(none yet — this is the first part of the meeting)'
  const previous = input.previousLines.length
    ? input.previousLines.map((line) => `${line.label}: ${line.text}`).join('\n')
    : '(no earlier transcript)'
  const vocabulary = (input.vocabulary ?? []).map((term) => term.trim()).filter(Boolean)
  const vocabularyBlock = vocabulary.length
    ? `VOCABULARY HINTS (improve recognition only — NEVER invent or substitute if the audio says something else):\n${vocabulary
        .slice(0, 40)
        .map((term) => `- ${term}`)
        .join('\n')}`
    : 'VOCABULARY HINTS: none beyond common technical terms.'

  return `You are Hilm's language-agnostic meeting transcriber. Transcribe the attached audio, which is part ${input.chunkIdx + 1} of a longer meeting recording.

THIS IS TRANSCRIPTION, NOT TRANSLATION.
- Write exactly what was spoken, in the script/language it was spoken.
- Do NOT translate Arabic ↔ English.
- Do NOT transliterate English into Arabic letters (e.g. never turn "today" into "توداي").
- Do NOT rewrite dialect Arabic into Modern Standard Arabic.
- Do NOT paraphrase, summarize, or "clean up" meaning.

NO MEETING-LEVEL LANGUAGE LOCK (critical):
- Detect language dynamically for EVERY segment of THIS audio part.
- The first seconds of the meeting, the UI language, a dominant language, or earlier transcript lines MUST NOT decide the language of later speech.
- If earlier parts were Arabic and this part has English, transcribe English in English.
- If earlier parts were English and this part has Arabic, transcribe Arabic in Arabic.
- Different speakers may use different languages. One speaker may switch languages mid-turn or mid-sentence.

CODE-SWITCHING (keep mixed text mixed):
- Good: "مرحبا، today we're going to discuss the new system."
- Good: "خلينا نراجع the API integration وبعدها نرسل التقرير."
- Good: "Okay خلينا نبدأ. أول شيء we need to check the database."
- Bad: translating the English half into Arabic.
- Bad: phonetic Arabic spellings of English words.

PROPER NOUNS / BRANDS / PRODUCTS (audio evidence first):
- Keep English company/product/people names in Latin script even inside Arabic sentences.
- Spoken "Visma" → "Visma". NOT "فيجم".
- Spoken "Milkman" → "Milkman". NEVER invent a different company (e.g. do NOT substitute "شركة دبل كليك").
- Also preserve: API, backend, frontend, deployment, database, production, testing, integration, Supabase, Netlify, Oracle, GitHub, CRM, ERP, Hilm, iMED, Visma, Milkman.
- Good: "الشركة تستخدم Visma في المحاسبة."
- Bad: replacing an uncertain name with a "related" entity from general knowledge.

ARABIC DIALECTS:
- Support Saudi, Gulf/Khaleeji, Lebanese/Levantine, Egyptian, MSA, and informal spoken Arabic.
- Dialect detection must NOT cause English words to be transliterated into Arabic.

SPEECH NATURALNESS:
- Keep fillers, repetitions, self-corrections, and incomplete sentences when audible.
- Omit inaudible parts; do not invent words for them.
- Add natural punctuation only.

SEGMENTATION & SPEAKERS:
- Split at speaker changes and natural pauses (max ~30 seconds per segment).
- Label speakers as "Speaker 1", "Speaker 2", ... Reuse known labels when the voice matches; add a new number only for a clearly new voice. Never invent real names.
- If there is no speech, return an empty "segments" array.
- "start"/"end" are seconds from the beginning of THIS audio part.

LANGUAGE METADATA:
- "language": "en", "ar", dialect/region tag ("ar-SA", "ar-LB", "ar-EG", "ar-AE", ...), or "mixed" when the segment itself code-switches.
- "languages": array of languages present in that segment, e.g. ["ar","en"] for mixed, ["en"] for English-only.
- Optional "confidence": 0–1 when available.
- Metadata must describe the spoken text; never rewrite the text to match a language tag.

${vocabularyBlock}

Known speakers so far:
${rosterText}

End of the previous part (speaker continuity ONLY — do NOT copy its language onto this audio, and do NOT repeat it):
${previous}

Return ONLY JSON:
{"segments":[{"speaker":"Speaker 1","start":0.0,"end":4.2,"text":"...","language":"mixed","languages":["ar","en"],"confidence":0.9}],"speakers":[{"label":"Speaker 1","description":"short neutral cue"}]}`
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
  timeZone?: string | null
}) {
  const roster = input.roster
    .map((speaker) => `- ${speaker.label}${speaker.display_name ? ` (named "${speaker.display_name}" by the user)` : ''}`)
    .join('\n')
  const uiLang = input.locale === 'ar' ? 'Arabic' : 'English'
  const tz = input.timeZone?.trim() || 'UTC'
  return `You are Hilm's multilingual meeting analyst. Analyse the meeting transcript and return structured JSON.

Meeting: "${input.title}"${input.projectName ? ` — project "${input.projectName}"` : ''}
Meeting date: ${input.meetingDate ?? 'unknown'}
Timezone for relative dates: ${tz}
User's Hilm UI language: ${uiLang} (use for analysis output language preference when the meeting is mixed; NEVER rewrite the transcript)
Speakers:
${roster || '- (unknown)'}

LANGUAGE RULES:
- Detect the dominant meeting language automatically from the transcript (Arabic, English, or mixed).
- Write summary, key_points, decisions, and action item titles/descriptions in that dominant language.
- If the meeting is mixed Arabic+English and the UI language is Arabic, prefer Arabic for the summary while keeping English technical terms (API, backend, deployment, testing, production, Visma, Milkman, etc.) in Latin script.
- If the meeting is clearly English, write the analysis in English even if the UI is Arabic.
- Do NOT translate the whole meeting into English. Do NOT invent MSA for dialect speech in quotes — paraphrase meaning in the analysis language.
- Never transliterate English proper nouns/brands into Arabic in the analysis, and never replace them with a different company/product.
- Action item titles should prefer the language used when that commitment was spoken.
- Analysis must NEVER rewrite, re-store, or "correct" the transcript itself — only produce summary/actions JSON.

MULTILINGUAL ACTION EXTRACTION:
- Extract actions whether spoken in English, Arabic, dialect Arabic, or mixed.
- Examples of commitments to capture:
  - "محمد، please finish the API integration by Thursday."
  - "خلّي أحمد يخلص الـ testing بكرا."
  - "I'll handle the backend and you can do the frontend."
- Owners may be Arabic names (محمد، أحمد) or English; map them to the matching speaker label when the user renamed a speaker, otherwise use Speaker N.

ARABIC DATE / TIME EXPRESSIONS:
- Understand natural Arabic and colloquial relative dates when the meaning is clear, relative to the meeting date and timezone ${tz}:
  اليوم، بكرا، بكرة، بعد بكرا، الأسبوع الجاي، نهاية الأسبوع، يوم الأحد، الخميس الجاي، بعد أسبوع، الشهر الجاي، الساعة ٣، الساعة ثلاثة ونص
- Also English: today, tomorrow, Thursday, end of week, next sprint, etc.
- "due_text": keep the deadline words exactly as said (Arabic or English). "due_date": YYYY-MM-DD only when clearly resolvable; else null. Never invent dates.

STRICT RULES — facts vs inferences:
- Only use what is in the transcript. Never fabricate decisions, attendees, owners, deadlines or commitments.
- "decisions": only things the group explicitly agreed or decided. If tentative, certainty "uncertain".
- "action_items": concrete follow-ups. certainty "confirmed" only when someone explicitly committed; otherwise "possible".
- "owner": exactly one speaker label from the list above (or null). owner_certainty "confirmed" only if that speaker explicitly took it on; "uncertain" if implied; null owner + "none" if unknown.
- "priority": only if clearly implied; else null.
- "sources": the [#n] reference numbers that support each item.
- "language": dominant language code, e.g. "en", "ar", "ar-SA".

Return ONLY JSON:
{"language":"ar","summary":"3-6 sentence summary","key_points":["..."],"decisions":[{"text":"...","certainty":"confirmed","sources":[3,4]}],"action_items":[{"title":"short imperative task title","description":"context from the meeting","owner":"Speaker 2","owner_certainty":"confirmed","due_text":"بكرا","due_date":"2026-01-02","priority":null,"certainty":"confirmed","sources":[7]}]}`
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
    case 'disabled':
      return 'Meeting AI is temporarily disabled. Please try again later.'
    case 'rate_limited':
      return "You've reached your AI usage limit. Please wait and try again."
    case 'ai_limit':
      return "You've reached your AI usage limit for today."
    case 'save_error':
      return 'Transcript could not be saved. Your audio is safe — retry processing.'
    case 'segment_failed':
      return 'Part of the recording could not be transcribed. Retry processing.'
    default:
      return 'Processing failed. Your audio is safe — retry processing.'
  }
}
