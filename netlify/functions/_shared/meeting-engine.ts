/** Meeting processing engine: per-segment transcription and whole-meeting analysis. */
import type { SupabaseClient } from '@supabase/supabase-js'
import { beginAiRequest, completeAiRequest, estimateTokensFromText, tokensFromOpenRouterUsage } from './ai-guard'
import { resolveAllowedAiModel } from './ai-limits'
import {
  MEETING_AUDIO_PRICING_MODEL,
  MEETING_AUTO_ATTEMPTS,
  MEETING_TRANSCRIBE_MODEL,
  analysisResponseSchema,
  buildAnalysisPrompt,
  buildAnalysisTranscript,
  buildTranscriptionPrompt,
  extractJsonObject,
  friendlyMeetingError,
  meetingTables,
  stitchChunkSegments,
  sanitizeAnalysis,
  type AnalysisLine,
  type MeetingOs,
  type RosterSpeaker,
} from './meeting-core'
import { callOpenRouter, transcribeAudioChunk } from './meeting-transcriber'

export const MEETING_BUCKET = 'meeting-audio'
const STALE_CLAIM_MS = 2 * 60_000

export type EngineContext = {
  client: SupabaseClient
  os: MeetingOs
  apiKey: string
  locale?: 'en' | 'ar'
  /** IANA timezone from the client for resolving relative Arabic/English dates. */
  timeZone?: string | null
}

export type MeetingRow = {
  id: string
  title: string
  status: 'draft' | 'recording' | 'processing' | 'ready' | 'failed'
  project_id: string | null
  user_id?: string
  workspace_id?: string
  created_by?: string
  held_at: string | null
  started_at: string | null
  language: string | null
  expected_segments: number | null
  processing_attempts: number
  processing_stage: string | null
  updated_at: string
}

type AudioRow = {
  id: string
  idx: number
  storage_path: string
  duration_ms: number
  offset_ms: number
  status: 'uploaded' | 'transcribing' | 'transcribed' | 'failed'
  attempts: number
  updated_at: string
}

export type StepResult =
  | { ok: true; state: 'transcribed' | 'analyzed' | 'idle' | 'waiting' | 'busy'; more: boolean }
  | { ok: false; code: string; message: string; status: number }

const MEETING_COLUMNS =
  'id, title, status, project_id, held_at, started_at, language, expected_segments, processing_attempts, processing_stage, updated_at'

export async function loadMeeting(ctx: EngineContext, meetingId: string): Promise<MeetingRow | null> {
  const tables = meetingTables(ctx.os)
  const ownerCols = ctx.os === 'workspace' ? ', workspace_id, created_by' : ', user_id'
  const { data, error } = await ctx.client
    .from(tables.meetings)
    .select(MEETING_COLUMNS + ownerCols)
    .eq('id', meetingId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as MeetingRow | null) ?? null
}

function scopeFor(ctx: EngineContext, meeting: MeetingRow) {
  return ctx.os === 'workspace' ? { workspace_id: meeting.workspace_id } : { user_id: meeting.user_id }
}

async function markMeetingFailed(ctx: EngineContext, meetingId: string, stage: string, message: string) {
  const tables = meetingTables(ctx.os)
  await ctx.client
    .from(tables.meetings)
    .update({ status: 'failed', processing_stage: stage, processing_error: message })
    .eq('id', meetingId)
}

// ── Transcription ───────────────────────────────────────────────────────────

export async function transcribeSegment(
  ctx: EngineContext,
  meeting: MeetingRow,
  idx: number,
): Promise<StepResult> {
  const tables = meetingTables(ctx.os)
  const { data: segmentData, error: segmentError } = await ctx.client
    .from(tables.audio)
    .select('id, idx, storage_path, duration_ms, offset_ms, status, attempts, updated_at')
    .eq('meeting_id', meeting.id)
    .eq('idx', idx)
    .maybeSingle()
  if (segmentError) throw new Error(segmentError.message)
  const segment = segmentData as AudioRow | null
  if (!segment) return { ok: false, code: 'not_found', message: 'Audio segment not found', status: 404 }
  if (segment.status === 'transcribed') return { ok: true, state: 'transcribed', more: true }
  if (segment.status === 'failed' && segment.attempts >= MEETING_AUTO_ATTEMPTS) {
    return { ok: false, code: 'segment_failed', message: 'This part of the recording failed. Use Retry.', status: 409 }
  }

  const staleIso = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: claimed, error: claimError } = await ctx.client
    .from(tables.audio)
    .update({ status: 'transcribing', attempts: segment.attempts + 1, error: null })
    .eq('id', segment.id)
    .eq('attempts', segment.attempts)
    .or(`status.in.(uploaded,failed),and(status.eq.transcribing,updated_at.lt.${staleIso})`)
    .select('id, attempts')
    .maybeSingle()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) return { ok: true, state: 'busy', more: true }
  const attempt = (claimed as { attempts: number }).attempts

  const failSegment = async (code: string, detail: string) => {
    await ctx.client
      .from(tables.audio)
      .update({ status: 'failed', error: friendlyMeetingError(code) })
      .eq('id', segment.id)
    if (attempt >= MEETING_AUTO_ATTEMPTS && meeting.status === 'processing') {
      await markMeetingFailed(ctx, meeting.id, 'transcription_failed', friendlyMeetingError(code))
    }
    console.error('meeting transcribe failed', { meetingId: meeting.id, idx, code, detail: detail.slice(0, 300) })
  }

  const guard = await beginAiRequest(ctx.client, {
    requestKind: 'meeting_transcribe',
    model: MEETING_TRANSCRIBE_MODEL,
    workspaceId: ctx.os === 'workspace' ? meeting.workspace_id : null,
    idempotencyKey: `meeting:${meeting.id}:seg:${idx}:a${attempt}`,
    fingerprint: `meeting:${meeting.id}:seg:${idx}`,
  })
  if (!guard.ok) {
    await ctx.client
      .from(tables.audio)
      .update({ status: segment.status === 'failed' ? 'failed' : 'uploaded', attempts: segment.attempts })
      .eq('id', segment.id)
    return {
      ok: false,
      code: guard.code || 'ai_limit',
      message: guard.message || 'AI usage limit reached',
      status: guard.code === 'tier_disabled' ? 403 : 429,
    }
  }
  const eventId = guard.event_id ?? null
  const complete = async (
    status: 'completed' | 'failed',
    extra: { inputTokens?: number; outputTokens?: number; errorCode?: string; errorMessage?: string } = {},
  ) => {
    if (!eventId) return
    await completeAiRequest(ctx.client, {
      eventId,
      status,
      model: MEETING_AUDIO_PRICING_MODEL,
      ...extra,
    })
  }

  const download = await ctx.client.storage.from(MEETING_BUCKET).download(segment.storage_path)
  if (download.error || !download.data) {
    await complete('failed', { errorCode: 'audio_missing', errorMessage: download.error?.message })
    await failSegment('audio_missing', download.error?.message ?? 'missing')
    return { ok: false, code: 'audio_missing', message: friendlyMeetingError('audio_missing'), status: 502 }
  }
  const audioBase64 = Buffer.from(await download.data.arrayBuffer()).toString('base64')

  const [{ data: speakerRows }, { data: previousRows }, projectResult] = await Promise.all([
    ctx.client
      .from(tables.speakers)
      .select('id, label, description, display_name, ordinal')
      .eq('meeting_id', meeting.id)
      .order('ordinal', { ascending: true }),
    ctx.client
      .from(tables.transcript)
      .select('text, speaker_id, ordinal')
      .eq('meeting_id', meeting.id)
      .lt('ordinal', idx * 10_000)
      .order('ordinal', { ascending: false })
      .limit(6),
    meeting.project_id
      ? ctx.client
          .from(ctx.os === 'workspace' ? 'workspace_projects' : 'projects')
          .select('name')
          .eq('id', meeting.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { name?: string } | null }),
  ])
  const roster = ((speakerRows ?? []) as Array<RosterSpeaker & { ordinal: number }>).slice()
  const labelById = new Map(roster.map((speaker) => [speaker.id, speaker.label]))
  const previousLines = ((previousRows ?? []) as Array<{ text: string; speaker_id: string | null }>)
    .reverse()
    .map((row) => ({ label: (row.speaker_id && labelById.get(row.speaker_id)) || 'Speaker', text: row.text }))
  const projectName = (projectResult.data as { name?: string } | null)?.name?.trim() || null

  // Never pass UI locale / meeting.language into transcription — that locks the whole chunk.
  const prompt = buildTranscriptionPrompt({
    roster,
    previousLines,
    chunkIdx: idx,
    vocabulary: [
      ...(projectName ? [projectName] : []),
      'Hilm',
      'Visma',
      'Milkman',
      'API',
      'Supabase',
      'Netlify',
      'GitHub',
    ],
  })

  const result = await transcribeAudioChunk({ apiKey: ctx.apiKey, audioBase64, prompt })
  if (!result.ok && result.code !== 'parse_error') {
    await complete('failed', { errorCode: result.code, errorMessage: result.detail.slice(0, 500) })
    await failSegment(result.code, result.detail)
    return { ok: false, code: result.code, message: friendlyMeetingError(result.code), status: 502 }
  }

  let usage = tokensFromOpenRouterUsage(result.usage)
  if (!usage.totalTokens) {
    // Gemini bills ~32 tokens per second of audio.
    const inputTokens = Math.ceil((segment.duration_ms / 1000) * 32) + estimateTokensFromText(prompt)
    const outputTokens = estimateTokensFromText(result.content ?? '')
    usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
  }

  if (!result.ok) {
    await complete('failed', {
      errorCode: 'parse_error',
      errorMessage: 'Unreadable transcription',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
    await failSegment('parse_error', result.detail)
    return { ok: false, code: 'parse_error', message: friendlyMeetingError('parse_error'), status: 502 }
  }

  const stitched = stitchChunkSegments({
    response: result.data,
    chunkIdx: idx,
    offsetMs: segment.offset_ms,
    durationMs: segment.duration_ms,
    roster,
  })

  // Ensure every label used has a speaker row.
  const scope = scopeFor(ctx, meeting)
  const knownLabels = new Set(roster.map((speaker) => speaker.label))
  const descriptions = new Map(
    (result.data.speakers ?? []).map((speaker) => [speaker.label.trim(), speaker.description?.trim() || null]),
  )
  const newLabels = [...new Set(stitched.map((row) => row.speakerLabel))].filter((label) => !knownLabels.has(label))
  if (newLabels.length) {
    const baseOrdinal = roster.length
    await ctx.client.from(tables.speakers).upsert(
      newLabels.map((label, i) => ({
        ...scope,
        meeting_id: meeting.id,
        label,
        description: descriptions.get(label) ?? null,
        ordinal: baseOrdinal + i,
      })),
      { onConflict: 'meeting_id,label', ignoreDuplicates: true },
    )
  }
  for (const speaker of roster) {
    const description = descriptions.get(speaker.label)
    if (!speaker.description && description) {
      await ctx.client.from(tables.speakers).update({ description }).eq('id', speaker.id)
    }
  }
  const { data: allSpeakers } = await ctx.client
    .from(tables.speakers)
    .select('id, label')
    .eq('meeting_id', meeting.id)
  const idByLabel = new Map(((allSpeakers ?? []) as Array<{ id: string; label: string }>).map((s) => [s.label, s.id]))

  await ctx.client.from(tables.transcript).delete().eq('audio_segment_id', segment.id)
  if (stitched.length) {
    const { error: insertError } = await ctx.client.from(tables.transcript).insert(
      stitched.map((row) => ({
        ...scope,
        meeting_id: meeting.id,
        audio_segment_id: segment.id,
        speaker_id: idByLabel.get(row.speakerLabel) ?? null,
        ordinal: row.ordinal,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        text: row.text,
        language: row.language,
        languages: row.languages,
      })),
    )
    if (insertError) {
      await complete('failed', {
        errorCode: 'save_error',
        errorMessage: insertError.message,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
      await failSegment('save_error', insertError.message)
      return { ok: false, code: 'save_error', message: friendlyMeetingError('save_error'), status: 500 }
    }
  }

  await ctx.client
    .from(tables.audio)
    .update({ status: 'transcribed', error: null, transcribed_at: new Date().toISOString() })
    .eq('id', segment.id)
  await complete('completed', { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
  return { ok: true, state: 'transcribed', more: true }
}

// ── Analysis ────────────────────────────────────────────────────────────────

export async function analyzeMeeting(ctx: EngineContext, meeting: MeetingRow): Promise<StepResult> {
  const tables = meetingTables(ctx.os)
  const staleIso = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: claimed, error: claimError } = await ctx.client
    .from(tables.meetings)
    .update({ processing_stage: 'analyzing', processing_error: null })
    .eq('id', meeting.id)
    .eq('status', 'processing')
    .or(`processing_stage.is.null,processing_stage.neq.analyzing,updated_at.lt.${staleIso}`)
    .select('id')
    .maybeSingle()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) return { ok: true, state: 'busy', more: false }

  const loadTranscript = async () => {
    const rows: unknown[] = []
    for (let from = 0; from < 20_000; from += 1000) {
      const { data, error } = await ctx.client
        .from(tables.transcript)
        .select('id, speaker_id, start_ms, text, ordinal')
        .eq('meeting_id', meeting.id)
        .order('ordinal', { ascending: true })
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    return { data: rows }
  }

  const [{ data: speakerRows }, { data: transcriptRows }, projectResult] = await Promise.all([
    ctx.client
      .from(tables.speakers)
      .select('id, label, display_name, ordinal')
      .eq('meeting_id', meeting.id)
      .order('ordinal', { ascending: true }),
    loadTranscript(),
    meeting.project_id
      ? ctx.client
          .from(ctx.os === 'workspace' ? 'workspace_projects' : 'projects')
          .select('name')
          .eq('id', meeting.project_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const speakers = (speakerRows ?? []) as Array<{ id: string; label: string; display_name: string | null }>
  const labelById = new Map(speakers.map((speaker) => [speaker.id, speaker.label]))
  const lines: AnalysisLine[] = ((transcriptRows ?? []) as Array<{
    id: string
    speaker_id: string | null
    start_ms: number
    text: string
  }>).map((row, i) => ({
    ref: i + 1,
    segmentId: row.id,
    speakerLabel: (row.speaker_id && labelById.get(row.speaker_id)) || 'Speaker',
    startMs: row.start_ms,
    text: row.text,
  }))

  const finishReady = async (patch: Record<string, unknown>) => {
    await ctx.client
      .from(tables.meetings)
      .update({
        status: 'ready',
        processing_stage: null,
        processing_error: null,
        analyzed_at: new Date().toISOString(),
        ...patch,
      })
      .eq('id', meeting.id)
  }

  if (!lines.length) {
    await ctx.client.from(tables.decisions).delete().eq('meeting_id', meeting.id)
    await ctx.client.from(tables.actions).delete().eq('meeting_id', meeting.id).is('task_id', null)
    await finishReady({ summary: null, key_points: [] })
    return { ok: true, state: 'analyzed', more: false }
  }

  const model = resolveAllowedAiModel({
    defaultModel: process.env.OPENROUTER_DEFAULT_MODEL?.trim() || 'google/gemini-2.5-flash',
    allowedEnv: process.env.OPENROUTER_ALLOWED_MODELS,
  })
  const guard = await beginAiRequest(ctx.client, {
    requestKind: 'meeting_analyze',
    model,
    workspaceId: ctx.os === 'workspace' ? meeting.workspace_id : null,
    idempotencyKey: `meeting:${meeting.id}:analyze:${meeting.processing_attempts}:${lines.length}`,
    fingerprint: `meeting:${meeting.id}:analyze`,
  })
  if (!guard.ok) {
    await ctx.client
      .from(tables.meetings)
      .update({ processing_stage: 'waiting_quota', processing_error: guard.message ?? null })
      .eq('id', meeting.id)
    return {
      ok: false,
      code: guard.code || 'ai_limit',
      message: guard.message || 'AI usage limit reached',
      status: guard.code === 'tier_disabled' ? 403 : 429,
    }
  }
  const eventId = guard.event_id ?? null
  const complete = async (
    status: 'completed' | 'failed',
    extra: { inputTokens?: number; outputTokens?: number; errorCode?: string; errorMessage?: string } = {},
  ) => {
    if (!eventId) return
    await completeAiRequest(ctx.client, { eventId, status, model, ...extra })
  }

  const meetingDate = (meeting.held_at ?? meeting.started_at ?? '').slice(0, 10) || null
  const systemPrompt = buildAnalysisPrompt({
    title: meeting.title,
    meetingDate,
    projectName: (projectResult.data as { name?: string } | null)?.name ?? null,
    roster: speakers.map((speaker) => ({ label: speaker.label, display_name: speaker.display_name })),
    locale: ctx.locale ?? 'en',
    timeZone: ctx.timeZone ?? null,
  })
  const transcriptText = buildAnalysisTranscript(lines)

  const result = await callOpenRouter(
    ctx.apiKey,
    {
      model,
      stream: false,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcript:\n${transcriptText}` },
      ],
    },
    'Hilm Meeting Analysis',
  )
  if (!result.ok) {
    await complete('failed', { errorCode: result.code, errorMessage: result.detail.slice(0, 500) })
    await markMeetingFailed(ctx, meeting.id, 'analysis_failed', friendlyMeetingError(result.code))
    return { ok: false, code: result.code, message: friendlyMeetingError(result.code), status: 502 }
  }

  let usage = tokensFromOpenRouterUsage(result.usage)
  if (!usage.totalTokens) {
    const inputTokens = estimateTokensFromText(systemPrompt + transcriptText)
    const outputTokens = estimateTokensFromText(result.content)
    usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
  }

  const parsedJson = extractJsonObject(result.content)
  const parsed = parsedJson ? analysisResponseSchema.safeParse(parsedJson) : null
  if (!parsed?.success) {
    await complete('failed', {
      errorCode: 'parse_error',
      errorMessage: 'Unreadable analysis',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
    await markMeetingFailed(ctx, meeting.id, 'analysis_failed', friendlyMeetingError('parse_error'))
    return { ok: false, code: 'parse_error', message: friendlyMeetingError('parse_error'), status: 502 }
  }

  const displayNames: Record<string, string> = {}
  for (const speaker of speakers) if (speaker.display_name) displayNames[speaker.label] = speaker.display_name
  const clean = sanitizeAnalysis(parsed.data, {
    lines,
    rosterLabels: speakers.map((speaker) => speaker.label),
    displayNames,
  })
  const idByLabel = new Map(speakers.map((speaker) => [speaker.label, speaker.id]))
  const scope = scopeFor(ctx, meeting)

  // Action items already turned into tasks are kept so task links survive re-analysis.
  const { data: linkedRows } = await ctx.client
    .from(tables.actions)
    .select('id, title')
    .eq('meeting_id', meeting.id)
    .not('task_id', 'is', null)
  const linkedTitles = new Set(
    ((linkedRows ?? []) as Array<{ title: string }>).map((row) => row.title.trim().toLowerCase()),
  )

  await ctx.client.from(tables.decisions).delete().eq('meeting_id', meeting.id)
  await ctx.client.from(tables.actions).delete().eq('meeting_id', meeting.id).is('task_id', null)

  if (clean.decisions.length) {
    await ctx.client.from(tables.decisions).insert(
      clean.decisions.map((decision, i) => ({
        ...scope,
        meeting_id: meeting.id,
        text: decision.text,
        certainty: decision.certainty,
        source_segment_ids: decision.source_segment_ids,
        ordinal: i,
      })),
    )
  }
  const freshItems = clean.action_items.filter((item) => !linkedTitles.has(item.title.toLowerCase()))
  if (freshItems.length) {
    const offset = linkedTitles.size
    await ctx.client.from(tables.actions).insert(
      freshItems.map((item, i) => ({
        ...scope,
        meeting_id: meeting.id,
        title: item.title,
        description: item.description,
        owner_speaker_id: item.ownerLabel ? idByLabel.get(item.ownerLabel) ?? null : null,
        owner_certainty: item.ownerLabel && idByLabel.has(item.ownerLabel) ? item.owner_certainty : 'none',
        due_text: item.due_text,
        due_date: item.due_date,
        priority: item.priority,
        certainty: item.certainty,
        source_segment_ids: item.source_segment_ids,
        ordinal: offset + i,
      })),
    )
  }

  await finishReady({
    summary: clean.summary || null,
    key_points: clean.key_points,
    language: clean.language ?? meeting.language,
    analysis_model: model,
  })
  await complete('completed', { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
  return { ok: true, state: 'analyzed', more: false }
}

// ── Orchestration ───────────────────────────────────────────────────────────

/** Do the next unit of work for a meeting: one pending segment, else analysis when complete. */
export async function advanceMeeting(ctx: EngineContext, meeting: MeetingRow): Promise<StepResult> {
  if (meeting.status !== 'recording' && meeting.status !== 'processing') {
    return { ok: true, state: 'idle', more: false }
  }
  const tables = meetingTables(ctx.os)
  const { data: rows, error } = await ctx.client
    .from(tables.audio)
    .select('idx, status, attempts, updated_at')
    .eq('meeting_id', meeting.id)
    .order('idx', { ascending: true })
  if (error) throw new Error(error.message)
  const segments = (rows ?? []) as Array<Pick<AudioRow, 'idx' | 'status' | 'attempts' | 'updated_at'>>
  const staleMs = Date.now() - STALE_CLAIM_MS

  const next = segments.find(
    (segment) =>
      segment.status === 'uploaded' ||
      (segment.status === 'failed' && segment.attempts < MEETING_AUTO_ATTEMPTS) ||
      (segment.status === 'transcribing' && new Date(segment.updated_at).getTime() < staleMs),
  )
  if (next) return transcribeSegment(ctx, meeting, next.idx)

  if (segments.some((segment) => segment.status === 'transcribing')) {
    return { ok: true, state: 'busy', more: true }
  }
  if (segments.some((segment) => segment.status === 'failed')) {
    if (meeting.status === 'processing') {
      await markMeetingFailed(ctx, meeting.id, 'transcription_failed', friendlyMeetingError('provider_error'))
    }
    return { ok: false, code: 'segment_failed', message: 'Part of the recording failed. Use Retry.', status: 409 }
  }

  if (meeting.status !== 'processing' || meeting.expected_segments === null) {
    return { ok: true, state: 'waiting', more: false }
  }
  if (segments.length < meeting.expected_segments) {
    return { ok: true, state: 'waiting', more: false }
  }
  return analyzeMeeting(ctx, meeting)
}

/** Manual retry after failure: re-queues failed parts without re-uploading audio. */
export async function retryMeeting(
  ctx: EngineContext,
  meeting: MeetingRow,
  maxRetries: number,
): Promise<StepResult> {
  if (meeting.status !== 'failed') {
    return { ok: false, code: 'not_failed', message: 'This meeting is not in a failed state.', status: 409 }
  }
  if (meeting.processing_attempts >= maxRetries) {
    return {
      ok: false,
      code: 'retry_limit',
      message: 'Retry limit reached for this meeting.',
      status: 429,
    }
  }
  const tables = meetingTables(ctx.os)
  await ctx.client
    .from(tables.audio)
    .update({ status: 'uploaded', attempts: 0, error: null })
    .eq('meeting_id', meeting.id)
    .in('status', ['failed', 'transcribing'])
  await ctx.client
    .from(tables.meetings)
    .update({
      status: 'processing',
      processing_stage: null,
      processing_error: null,
      processing_attempts: meeting.processing_attempts + 1,
    })
    .eq('id', meeting.id)
  return { ok: true, state: 'waiting', more: true }
}
