/** Meeting processing engine: per-segment transcription and whole-meeting analysis. */
import type { SupabaseClient } from '@supabase/supabase-js'
import { featureDisabledMessage } from './ai-config'
import { loadEffectiveAiConfig } from './ai-runtime-db'
import { beginAiRequest, completeAiRequest, estimateTokensFromText, tokensFromOpenRouterUsage } from './ai-guard'
import { hashBytes } from './ai-gateway'
import { resolveAllowedAiModel } from './ai-limits'
import { hashAnalysisInput, runMeetingAnalysis } from './meeting-analysis'
import {
  MEETING_AUDIO_PRICING_MODEL,
  MEETING_AUTO_ATTEMPTS,
  MEETING_TRANSCRIBE_MODEL,
  buildTranscriptionPrompt,
  friendlyMeetingError,
  meetingTables,
  stitchChunkSegments,
  type AnalysisLine,
  type MeetingOs,
  type RosterSpeaker,
} from './meeting-core'
import { transcribeAudioChunk } from './meeting-transcriber'

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
  summary?: string | null
  expected_segments: number | null
  processing_attempts: number
  processing_stage: string | null
  analysis_input_hash?: string | null
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
  content_hash?: string | null
  updated_at: string
}

export type StepResult =
  | { ok: true; state: 'transcribed' | 'analyzed' | 'idle' | 'waiting' | 'busy'; more: boolean }
  | { ok: false; code: string; message: string; status: number }

const MEETING_COLUMNS_BASE =
  'id, title, status, project_id, held_at, started_at, language, summary, expected_segments, processing_attempts, processing_stage, updated_at'
const MEETING_COLUMNS =
  `${MEETING_COLUMNS_BASE}, analysis_input_hash`

function isMissingColumnError(message: string | undefined) {
  const text = (message || '').toLowerCase()
  return text.includes('does not exist') || text.includes('could not find') || text.includes('analysis_input_hash') || text.includes('content_hash')
}

/** Soft-write optional migration-0028 columns so deploys stay safe before the SQL lands. */
async function softUpdate(
  ctx: EngineContext,
  table: string,
  patch: Record<string, unknown>,
  match: { column: string; value: string },
) {
  const { error } = await ctx.client.from(table).update(patch).eq(match.column, match.value)
  if (!error) return
  if (!isMissingColumnError(error.message)) throw new Error(error.message)
  const fallback = { ...patch }
  delete fallback.analysis_input_hash
  delete fallback.content_hash
  if (Object.keys(fallback).length === Object.keys(patch).length) throw new Error(error.message)
  if (!Object.keys(fallback).length) return
  const retry = await ctx.client.from(table).update(fallback).eq(match.column, match.value)
  if (retry.error) throw new Error(retry.error.message)
}

export async function loadMeeting(ctx: EngineContext, meetingId: string): Promise<MeetingRow | null> {
  const tables = meetingTables(ctx.os)
  const ownerCols = ctx.os === 'workspace' ? ', workspace_id, created_by' : ', user_id'
  const primary = await ctx.client
    .from(tables.meetings)
    .select(MEETING_COLUMNS + ownerCols)
    .eq('id', meetingId)
    .maybeSingle()
  if (!primary.error) return (primary.data as unknown as MeetingRow | null) ?? null
  if (!isMissingColumnError(primary.error.message)) throw new Error(primary.error.message)
  // Migration 0028 not applied yet — load without analysis_input_hash.
  const fallback = await ctx.client
    .from(tables.meetings)
    .select(MEETING_COLUMNS_BASE + ownerCols)
    .eq('id', meetingId)
    .maybeSingle()
  if (fallback.error) throw new Error(fallback.error.message)
  return (fallback.data as unknown as MeetingRow | null) ?? null
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
  const runtime = await loadEffectiveAiConfig(ctx.client)
  if (!runtime.aiEnabled || !runtime.transcriptionEnabled) {
    return {
      ok: false,
      code: 'disabled',
      message: featureDisabledMessage('meeting_transcription'),
      status: 403,
    }
  }

  const tables = meetingTables(ctx.os)
  const audioSelectWithHash =
    'id, idx, storage_path, duration_ms, offset_ms, status, attempts, content_hash, updated_at'
  const audioSelectBase = 'id, idx, storage_path, duration_ms, offset_ms, status, attempts, updated_at'
  let segmentQuery = await ctx.client
    .from(tables.audio)
    .select(audioSelectWithHash)
    .eq('meeting_id', meeting.id)
    .eq('idx', idx)
    .maybeSingle()
  if (segmentQuery.error && isMissingColumnError(segmentQuery.error.message)) {
    segmentQuery = await ctx.client
      .from(tables.audio)
      .select(audioSelectBase)
      .eq('meeting_id', meeting.id)
      .eq('idx', idx)
      .maybeSingle()
  }
  if (segmentQuery.error) throw new Error(segmentQuery.error.message)
  const segment = segmentQuery.data as AudioRow | null
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

  const download = await ctx.client.storage.from(MEETING_BUCKET).download(segment.storage_path)
  if (download.error || !download.data) {
    await failSegment('audio_missing', download.error?.message ?? 'missing')
    return { ok: false, code: 'audio_missing', message: friendlyMeetingError('audio_missing'), status: 502 }
  }
  const audioBuffer = Buffer.from(await download.data.arrayBuffer())
  const contentHash = hashBytes(audioBuffer)
  const audioBase64 = audioBuffer.toString('base64')
  if (!segment.content_hash || segment.content_hash !== contentHash) {
    await softUpdate(ctx, tables.audio, { content_hash: contentHash }, { column: 'id', value: segment.id })
  }

  // Idempotency: same meeting+chunk+audio hash already billed successfully → do not re-pay.
  const guard = await beginAiRequest(ctx.client, {
    requestKind: 'meeting_transcribe',
    model: runtime.models.meeting_transcription || MEETING_TRANSCRIBE_MODEL,
    workspaceId: ctx.os === 'workspace' ? meeting.workspace_id : null,
    idempotencyKey: `meeting:${meeting.id}:seg:${idx}:h:${contentHash.slice(0, 16)}:a${attempt}`,
    fingerprint: `meeting:${meeting.id}:seg:${idx}`,
  })
  if (!guard.ok) {
    const alreadyDone = guard.code === 'duplicate' && guard.status === 'completed'
    if (alreadyDone) {
      const { count } = await ctx.client
        .from(tables.transcript)
        .select('id', { count: 'exact', head: true })
        .eq('audio_segment_id', segment.id)
      if ((count ?? 0) > 0) {
        await ctx.client
          .from(tables.audio)
          .update({ status: 'transcribed', error: null, transcribed_at: new Date().toISOString() })
          .eq('id', segment.id)
        return { ok: true, state: 'transcribed', more: true }
      }
    }
    await ctx.client
      .from(tables.audio)
      .update({ status: segment.status === 'failed' ? 'failed' : 'uploaded', attempts: segment.attempts })
      .eq('id', segment.id)
    return {
      ok: false,
      code: guard.code || 'ai_limit',
      message: guard.message || 'AI usage limit reached',
      status: guard.code === 'tier_disabled' || guard.code === 'disabled' ? 403 : 429,
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

  const previousLimit = runtime.meeting.previousContextLines
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
      .limit(previousLimit),
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

  const result = await transcribeAudioChunk({
    apiKey: ctx.apiKey,
    audioBase64,
    prompt,
    model: runtime.models.meeting_transcription,
  })
  if (!result.ok && result.code !== 'parse_error') {
    await complete('failed', { errorCode: result.code, errorMessage: result.detail.slice(0, 500) })
    await failSegment(result.code, result.detail)
    const status = result.code === 'disabled' ? 403 : 502
    return {
      ok: false,
      code: result.code,
      message: result.code === 'disabled' ? result.detail : friendlyMeetingError(result.code),
      status,
    }
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
  const runtime = await loadEffectiveAiConfig(ctx.client)
  if (!runtime.aiEnabled || !runtime.analysisEnabled) {
    // Transcript is already stored — surface a clear limit state instead of failing hard forever.
    await softUpdate(
      ctx,
      meetingTables(ctx.os).meetings,
      {
        status: 'ready',
        processing_stage: null,
        processing_error: featureDisabledMessage('meeting_analyze'),
        analyzed_at: new Date().toISOString(),
      },
      { column: 'id', value: meeting.id },
    )
    return { ok: true, state: 'analyzed', more: false }
  }

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
    await softUpdate(
      ctx,
      tables.meetings,
      {
        status: 'ready',
        processing_stage: null,
        processing_error: null,
        analyzed_at: new Date().toISOString(),
        ...patch,
      },
      { column: 'id', value: meeting.id },
    )
  }

  if (!lines.length) {
    await ctx.client.from(tables.decisions).delete().eq('meeting_id', meeting.id)
    await ctx.client.from(tables.actions).delete().eq('meeting_id', meeting.id).is('task_id', null)
    await finishReady({ summary: null, key_points: [] })
    return { ok: true, state: 'analyzed', more: false }
  }

  const model = resolveAllowedAiModel({
    defaultModel: runtime.models.meeting_analyze,
    allowedEnv: process.env.OPENROUTER_ALLOWED_MODELS,
  })
  const analysisInputHash = hashAnalysisInput(lines)

  // Cache hit: identical transcript already analyzed — do not re-bill.
  if (meeting.analysis_input_hash === analysisInputHash && meeting.summary) {
    await finishReady({ analysis_input_hash: analysisInputHash })
    return { ok: true, state: 'analyzed', more: false }
  }

  const guard = await beginAiRequest(ctx.client, {
    requestKind: 'meeting_analyze',
    model,
    workspaceId: ctx.os === 'workspace' ? meeting.workspace_id : null,
    idempotencyKey: `meeting:${meeting.id}:analyze:${analysisInputHash.slice(0, 24)}:a${meeting.processing_attempts}`,
    fingerprint: `meeting:${meeting.id}:analyze`,
  })
  if (!guard.ok) {
    if (guard.code === 'duplicate' && guard.status === 'completed' && meeting.summary) {
      await finishReady({ analysis_input_hash: analysisInputHash })
      return { ok: true, state: 'analyzed', more: false }
    }
    await ctx.client
      .from(tables.meetings)
      .update({ processing_stage: 'waiting_quota', processing_error: guard.message ?? null })
      .eq('id', meeting.id)
    return {
      ok: false,
      code: guard.code || 'ai_limit',
      message: guard.message || "You've reached your AI usage limit for today.",
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

  const result = await runMeetingAnalysis({
    apiKey: ctx.apiKey,
    title: meeting.title,
    meetingDate: (meeting.held_at ?? meeting.started_at ?? '').slice(0, 10) || null,
    projectName: (projectResult.data as { name?: string } | null)?.name ?? null,
    roster: speakers.map((speaker) => ({ label: speaker.label, display_name: speaker.display_name })),
    locale: ctx.locale ?? 'en',
    timeZone: ctx.timeZone ?? null,
    lines,
    model,
    existing: null,
  })

  if (!result.ok) {
    await complete('failed', {
      errorCode: result.code,
      errorMessage: result.detail.slice(0, 500),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    })
    await markMeetingFailed(ctx, meeting.id, 'analysis_failed', friendlyMeetingError(result.code))
    return {
      ok: false,
      code: result.code,
      message: result.code === 'disabled' ? result.detail : friendlyMeetingError(result.code),
      status: result.code === 'disabled' ? 403 : 502,
    }
  }

  const clean = result.analysis
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
    analysis_model: result.model,
    analysis_input_hash: result.analysisInputHash,
  })
  await complete('completed', { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens })
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
