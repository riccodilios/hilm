/**
 * Meeting transcription routing. Soniox async STT transcribes the whole finalized meeting in one
 * job; the existing per-part Gemini path (meeting-engine transcribeSegment) is the automatic
 * fallback when Soniox genuinely fails. Durable stt_* columns on the meeting row coordinate the
 * providers so a meeting is never transcribed by both at once.
 */
import { createHash, randomBytes } from 'node:crypto'
import { featureDisabledMessage } from './ai-config'
import { loadEffectiveAiConfig } from './ai-runtime-db'
import { beginAiRequest, completeAiRequest } from './ai-guard'
import {
  MEETING_BUCKET,
  MEETING_DEFAULT_VOCABULARY,
  MEETING_TRANSCRIBE_MODEL,
  friendlyMeetingError,
  meetingTables,
} from './meeting-core'
import {
  SONIOX_LANGUAGE_HINTS,
  SONIOX_MAX_AUDIO_MS,
  SONIOX_PRICING_MODEL,
  SONIOX_WEBHOOK_HEADER,
  buildSonioxContext,
  buildWavHeader,
  estimateSonioxUsage,
  parseWavPcm,
  pcmDurationMs,
  sameFormat,
  sonioxContextChars,
  sonioxReference,
  sonioxTokensToLines,
  sonioxTranscriptProblem,
  type PcmFormat,
  type SonioxUsage,
} from './meeting-soniox'
import { SONIOX_ASYNC_MODEL, createSonioxClient, sonioxApiKey, withSonioxRetry, type SonioxClient } from './soniox'
import type { EngineContext, MeetingRow, StepResult } from './meeting-engine'

export type SttState =
  | 'pending'
  | 'soniox_processing'
  | 'soniox_completed'
  | 'soniox_failed'
  | 'gemini_fallback'
  | 'gemini_processing'
  | 'completed'
  | 'failed'
export type SttRoute = 'soniox_primary' | 'gemini_fallback' | 'gemini_primary'

export type MeetingSttFields = {
  stt_provider?: 'soniox' | 'gemini' | null
  stt_state?: SttState | null
  stt_model?: string | null
  stt_job_id?: string | null
  stt_file_id?: string | null
  stt_audio_ms?: number | null
  stt_usage_event_id?: string | null
  stt_fallback?: boolean | null
  stt_error?: string | null
  stt_started_at?: string | null
  stt_upload_claimed_at?: string | null
  stt_submitted_at?: string | null
  stt_checked_at?: string | null
  stt_webhook_status?: 'completed' | 'error' | null
}

export const STT_COLUMNS =
  'stt_provider, stt_state, stt_model, stt_job_id, stt_file_id, stt_audio_ms, stt_usage_event_id, stt_fallback, stt_error, stt_started_at, stt_upload_claimed_at, stt_submitted_at, stt_checked_at, stt_webhook_status'

const SONIOX_STATES = new Set<SttState>(['pending', 'soniox_processing', 'soniox_completed', 'soniox_failed'])

/** Re-check a running job at most this often unless the webhook already reported back. */
const POLL_INTERVAL_MS = 15_000
/** The background submission must claim the upload within this window after dispatch. */
const DISPATCH_GRACE_MS = 3 * 60_000
/** Background functions stop after 15 minutes; a claimed upload with no job after this is dead. */
const UPLOAD_STALE_MS = 16 * 60_000
/** A completed job whose transcript save stalled is re-saved after this (matches STT claims). */
const PERSIST_STALE_MS = 75_000
/** Processing deadline = this + audio length, so a slow queue never triggers a double charge. */
const PROCESSING_GRACE_MS = 30 * 60_000

export type SegmentSummary = { idx: number; status: string; attempts: number; updated_at: string }

type AudioPart = {
  id: string
  idx: number
  storage_path: string
  duration_ms: number
  offset_ms: number
  byte_size: number | null
}

export type SttDeps = {
  loadMeeting: (ctx: EngineContext, meetingId: string) => Promise<MeetingRow | null>
  soniox?: SonioxClient
  dispatchSubmission?: (ctx: EngineContext, meeting: MeetingRow) => Promise<'accepted' | 'rejected' | 'unknown'>
  sleep?: (ms: number) => Promise<void>
}

const BUSY: StepResult = { ok: true, state: 'busy', more: true }
const WAITING: StepResult = { ok: true, state: 'waiting', more: false }

/** MEETING_STT_PRIMARY=gemini is the emergency switch back to Gemini-only transcription. */
export function resolveSonioxKey(): string | null {
  if (process.env.MEETING_STT_PRIMARY?.trim().toLowerCase() === 'gemini') return null
  return sonioxApiKey()
}

export function hasSttColumns(meeting: MeetingRow): boolean {
  return Object.prototype.hasOwnProperty.call(meeting, 'stt_state')
}

function canSubmit(ctx: EngineContext) {
  return Boolean(ctx.sonioxKey && ctx.origin && ctx.authToken)
}

/**
 * True when a direct per-part Gemini call must not run: Soniox owns (or will own) the meeting,
 * or the switch to the Gemini fallback is still resetting the parts.
 */
export function sonioxOwnsMeeting(ctx: EngineContext, meeting: MeetingRow): boolean {
  if (!hasSttColumns(meeting)) return false
  const state = meeting.stt_state ?? null
  if (state !== null) return SONIOX_STATES.has(state) || state === 'gemini_fallback'
  return canSubmit(ctx)
}

/** The route a direct per-part Gemini call runs as (ledger tagging). */
export function geminiRouteFor(meeting: MeetingRow): SttRoute {
  return meeting.stt_fallback ? 'gemini_fallback' : 'gemini_primary'
}

function ts(value: string | null | undefined) {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function sha256Hex(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function sonioxFor(ctx: EngineContext, deps: Pick<SttDeps, 'soniox'>): SonioxClient | null {
  if (deps.soniox) return deps.soniox
  return ctx.sonioxKey ? createSonioxClient({ apiKey: ctx.sonioxKey }) : null
}

/** Records provider + route on a ledger event. Optional: never blocks transcription. */
export async function tagUsageEvent(
  ctx: EngineContext,
  eventId: string | null | undefined,
  provider: 'soniox' | 'openrouter',
  route: SttRoute,
) {
  if (!eventId) return
  try {
    await ctx.client.rpc('tag_ai_usage_event', { p_event_id: eventId, p_provider: provider, p_stt_route: route })
  } catch {
    // Pre-migration databases lack the RPC; the ledger row itself is already written.
  }
}

async function loadParts(ctx: EngineContext, meetingId: string): Promise<AudioPart[]> {
  const { data, error } = await ctx.client
    .from(meetingTables(ctx.os).audio)
    .select('id, idx, storage_path, duration_ms, offset_ms, byte_size')
    .eq('meeting_id', meetingId)
    .order('idx', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as AudioPart[]
}

async function updateMeeting(ctx: EngineContext, meetingId: string, patch: Record<string, unknown>) {
  const { error } = await ctx.client.from(meetingTables(ctx.os).meetings).update(patch).eq('id', meetingId)
  if (error) throw new Error(error.message)
}

/** Compare-and-set on stt_state; only one worker wins each transition. */
async function transition(
  ctx: EngineContext,
  meetingId: string,
  from: SttState | null,
  patch: Record<string, unknown>,
  extra?: { column: string; value: string | null },
): Promise<boolean> {
  let query = ctx.client.from(meetingTables(ctx.os).meetings).update(patch).eq('id', meetingId)
  query = from === null ? query.is('stt_state', null) : query.eq('stt_state', from)
  if (extra) query = extra.value === null ? query.is(extra.column, null) : query.eq(extra.column, extra.value)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

async function cleanupSoniox(
  ctx: EngineContext,
  deps: Pick<SttDeps, 'soniox'>,
  jobId: string | null | undefined,
  fileId: string | null | undefined,
) {
  const soniox = sonioxFor(ctx, deps)
  if (!soniox) return
  if (jobId) await soniox.deleteTranscription(jobId).catch(() => undefined)
  if (fileId) await soniox.deleteFile(fileId).catch(() => undefined)
}

async function projectNameFor(ctx: EngineContext, meeting: MeetingRow) {
  if (!meeting.project_id) return null
  const { data } = await ctx.client
    .from(ctx.os === 'workspace' ? 'workspace_projects' : 'projects')
    .select('name')
    .eq('id', meeting.project_id)
    .maybeSingle()
  return (data as { name?: string } | null)?.name?.trim() || null
}

async function sonioxContextFor(ctx: EngineContext, meeting: MeetingRow) {
  return buildSonioxContext({
    title: meeting.title,
    projectName: await projectNameFor(ctx, meeting),
    vocabulary: MEETING_DEFAULT_VOCABULARY,
  })
}

/**
 * Marks the Soniox attempt failed (recording why), closes its ledger event as failed and frees
 * the Soniox job/file. Returns false when another worker already moved the state on.
 */
async function failSoniox(
  ctx: EngineContext,
  meeting: MeetingRow,
  from: SttState | null,
  reason: string,
  deps: Pick<SttDeps, 'soniox'>,
  billed?: SonioxUsage & { audioMs: number },
): Promise<boolean> {
  const moved = await transition(ctx, meeting.id, from, {
    stt_state: 'soniox_failed',
    stt_error: reason.slice(0, 120),
    stt_checked_at: new Date().toISOString(),
    processing_stage: null,
    processing_error: null,
  })
  if (!moved) return false
  if (meeting.stt_usage_event_id && (from === 'soniox_processing' || from === 'soniox_completed')) {
    await completeAiRequest(ctx.client, {
      eventId: meeting.stt_usage_event_id,
      status: 'failed',
      model: SONIOX_PRICING_MODEL,
      errorCode: reason.slice(0, 60),
      errorMessage: 'Soniox transcription failed; Gemini fallback used',
      // A completed job with an unusable transcript was still billed by Soniox.
      ...(billed
        ? {
            inputTokens: billed.inputTokens,
            outputTokens: billed.outputTokens,
            audioTokens: billed.audioTokens,
            audioMs: billed.audioMs,
            costUsd: billed.costUsd,
          }
        : {}),
    })
  }
  await cleanupSoniox(ctx, deps, meeting.stt_job_id, meeting.stt_file_id)
  console.warn('meeting stt soniox failed', { meetingId: meeting.id, reason: reason.slice(0, 120) })
  return true
}

/** Soniox → Gemini: clear any partial transcript and re-queue every part for the Gemini path. */
async function startGeminiFallback(ctx: EngineContext, meeting: MeetingRow): Promise<StepResult> {
  const moved = await transition(ctx, meeting.id, 'soniox_failed', {
    stt_state: 'gemini_fallback',
    stt_provider: 'gemini',
    stt_model: MEETING_TRANSCRIBE_MODEL,
    stt_fallback: true,
    processing_stage: null,
    processing_error: null,
  })
  if (!moved) return BUSY
  return finishFallbackReset(ctx, meeting)
}

async function finishFallbackReset(ctx: EngineContext, meeting: MeetingRow): Promise<StepResult> {
  const tables = meetingTables(ctx.os)
  const removed = await ctx.client.from(tables.transcript).delete().eq('meeting_id', meeting.id)
  if (removed.error) throw new Error(removed.error.message)
  const reset = await ctx.client
    .from(tables.audio)
    .update({ status: 'uploaded', attempts: 0, error: null })
    .eq('meeting_id', meeting.id)
  if (reset.error) throw new Error(reset.error.message)
  await transition(ctx, meeting.id, 'gemini_fallback', { stt_state: 'gemini_processing' })
  // The next advance starts the Gemini parts from freshly loaded segment state.
  return BUSY
}

async function failAndFallback(
  ctx: EngineContext,
  meeting: MeetingRow,
  from: SttState | null,
  reason: string,
  deps: SttDeps,
  billed?: SonioxUsage & { audioMs: number },
): Promise<StepResult> {
  const failed = await failSoniox(ctx, meeting, from, reason, deps, billed)
  if (!failed) return BUSY
  return startGeminiFallback(ctx, { ...meeting, stt_state: 'soniox_failed' })
}

async function dispatchSubmission(ctx: EngineContext, meeting: MeetingRow): Promise<'accepted' | 'rejected' | 'unknown'> {
  try {
    const response = await fetch(`${ctx.origin}/.netlify/functions/meeting-stt-background`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ os: ctx.os, meetingId: meeting.id }),
      signal: AbortSignal.timeout(10_000),
    })
    return response.status === 202 || response.ok ? 'accepted' : 'rejected'
  } catch {
    // Unknown outcome: the job may be running, so wait for the dispatch grace period instead.
    return 'unknown'
  }
}

async function submitSoniox(ctx: EngineContext, meeting: MeetingRow, deps: SttDeps): Promise<StepResult | null> {
  const from = (meeting.stt_state ?? null) as SttState | null
  const runtime = await loadEffectiveAiConfig(ctx.client)
  if (!runtime.aiEnabled || !runtime.transcriptionEnabled) {
    return { ok: false, code: 'disabled', message: featureDisabledMessage('meeting_transcription'), status: 403 }
  }
  if (!canSubmit(ctx)) return failAndFallback(ctx, meeting, from, 'not_configured', deps)

  const parts = await loadParts(ctx, meeting.id)
  const totalMs = parts.reduce((sum, part) => sum + Math.max(0, part.duration_ms), 0)
  if (totalMs > SONIOX_MAX_AUDIO_MS) return failAndFallback(ctx, meeting, from, 'audio_too_long', deps)

  // One logical Soniox operation per meeting audio set: the key never changes for the same parts.
  const manifest = sha256Hex(
    parts.map((part) => `${part.idx}:${part.storage_path}:${part.byte_size ?? ''}:${part.duration_ms}`).join('|'),
  )
  const idempotencyKey = `meeting:${meeting.id}:soniox:h:${manifest.slice(0, 16)}`
  const begin = (key: string) =>
    beginAiRequest(ctx.client, {
      requestKind: 'meeting_transcribe',
      model: SONIOX_PRICING_MODEL,
      workspaceId: ctx.os === 'workspace' ? meeting.workspace_id : null,
      idempotencyKey: key,
      fingerprint: `meeting:${meeting.id}:soniox`,
    })
  let guard = await begin(idempotencyKey)
  if (!guard.ok && guard.code === 'duplicate' && guard.status === 'completed') {
    // Billed before but the transcript never landed: one orphan recovery key only.
    guard = await begin(`${idempotencyKey}:orphan`)
    if (!guard.ok && guard.code === 'duplicate') {
      return failAndFallback(ctx, meeting, from, 'duplicate_billing_guard', deps)
    }
  }
  if (!guard.ok) {
    if (
      guard.code === 'in_flight' ||
      guard.code === 'duplicate_execution' ||
      (guard.code === 'duplicate' && guard.status === 'started')
    ) {
      return BUSY
    }
    await updateMeeting(ctx, meeting.id, { processing_stage: 'waiting_quota', processing_error: guard.message ?? null })
    return {
      ok: false,
      code: guard.code || 'ai_limit',
      message: guard.message || 'AI usage limit reached',
      status: guard.code === 'tier_disabled' || guard.code === 'disabled' ? 403 : 429,
    }
  }
  const eventId = guard.event_id ?? null

  const claimed = await transition(ctx, meeting.id, from, {
    stt_state: 'soniox_processing',
    stt_provider: 'soniox',
    stt_model: SONIOX_ASYNC_MODEL,
    stt_fallback: false,
    stt_error: null,
    stt_job_id: null,
    stt_file_id: null,
    stt_audio_hash: null,
    stt_audio_ms: totalMs,
    stt_usage_event_id: eventId,
    stt_started_at: new Date().toISOString(),
    stt_upload_claimed_at: null,
    stt_submitted_at: null,
    stt_checked_at: null,
    stt_completed_at: null,
    stt_webhook_token_hash: null,
    stt_webhook_status: null,
    stt_webhook_at: null,
    processing_stage: 'transcribing',
    processing_error: null,
  })
  if (!claimed) {
    if (eventId) {
      await completeAiRequest(ctx.client, {
        eventId,
        status: 'failed',
        model: SONIOX_PRICING_MODEL,
        errorCode: 'claim_lost',
      })
    }
    return BUSY
  }
  await tagUsageEvent(ctx, eventId, 'soniox', 'soniox_primary')

  const claimedMeeting: MeetingRow = {
    ...meeting,
    stt_state: 'soniox_processing',
    stt_usage_event_id: eventId,
    stt_job_id: null,
    stt_file_id: null,
  }
  const outcome = await (deps.dispatchSubmission ?? dispatchSubmission)(ctx, claimedMeeting)
  if (outcome === 'rejected') {
    return failAndFallback(ctx, claimedMeeting, 'soniox_processing', 'dispatch_failed', deps)
  }
  return BUSY
}

async function pollSoniox(ctx: EngineContext, meeting: MeetingRow, deps: SttDeps): Promise<StepResult | null> {
  const now = Date.now()
  const soniox = sonioxFor(ctx, deps)
  if (!soniox) return failAndFallback(ctx, meeting, 'soniox_processing', 'not_configured', deps)

  if (!meeting.stt_job_id) {
    const claimedAt = ts(meeting.stt_upload_claimed_at)
    if (claimedAt !== null) {
      if (now - claimedAt > UPLOAD_STALE_MS) {
        return failAndFallback(ctx, meeting, 'soniox_processing', 'submission_timeout', deps)
      }
    } else if (now - (ts(meeting.stt_started_at) ?? now) > DISPATCH_GRACE_MS) {
      return failAndFallback(ctx, meeting, 'soniox_processing', 'dispatch_timeout', deps)
    }
    return BUSY
  }

  const checkedAt = ts(meeting.stt_checked_at)
  if (!meeting.stt_webhook_status && checkedAt !== null && now - checkedAt < POLL_INTERVAL_MS) return BUSY

  const submittedAt = ts(meeting.stt_submitted_at) ?? ts(meeting.stt_started_at) ?? now
  const deadlinePassed = now - submittedAt > PROCESSING_GRACE_MS + Math.max(0, meeting.stt_audio_ms ?? 0)
  const stillRunning = async () => {
    if (deadlinePassed) return failAndFallback(ctx, meeting, 'soniox_processing', 'processing_timeout', deps)
    await transition(
      ctx,
      meeting.id,
      'soniox_processing',
      { stt_checked_at: new Date().toISOString(), stt_webhook_status: null },
      { column: 'stt_job_id', value: meeting.stt_job_id ?? null },
    )
    return BUSY
  }

  const info = await soniox.getTranscription(meeting.stt_job_id)
  if (!info.ok) {
    if (!info.retryable) return failAndFallback(ctx, meeting, 'soniox_processing', `soniox_${info.code}`, deps)
    return stillRunning()
  }
  // Job ids live on a user-writable row: only accept the job Hilm created for this meeting.
  if (info.data.client_reference_id !== sonioxReference(ctx.os, meeting.id)) {
    return failAndFallback(ctx, meeting, 'soniox_processing', 'reference_mismatch', deps)
  }
  if (info.data.status === 'error') {
    const type = (info.data.error_type || 'error').replace(/[^a-z0-9_]/gi, '').slice(0, 40)
    return failAndFallback(ctx, meeting, 'soniox_processing', `soniox_${type}`, deps)
  }
  if (info.data.status !== 'completed') return stillRunning()

  const audioMs = info.data.audio_duration_ms || meeting.stt_audio_ms || 0
  const claimed = await transition(
    ctx,
    meeting.id,
    'soniox_processing',
    { stt_state: 'soniox_completed', stt_checked_at: new Date().toISOString(), stt_audio_ms: audioMs },
    { column: 'stt_job_id', value: meeting.stt_job_id },
  )
  if (!claimed) return BUSY
  return persistSoniox(ctx, { ...meeting, stt_state: 'soniox_completed', stt_audio_ms: audioMs }, deps)
}

/** A completed job whose save stalled (worker killed) is re-saved once the claim goes stale. */
async function resumeSonioxPersist(ctx: EngineContext, meeting: MeetingRow, deps: SttDeps): Promise<StepResult | null> {
  const checkedAt = ts(meeting.stt_checked_at)
  if (checkedAt !== null && Date.now() - checkedAt < PERSIST_STALE_MS) return BUSY
  const reclaimed = await transition(
    ctx,
    meeting.id,
    'soniox_completed',
    { stt_checked_at: new Date().toISOString() },
    { column: 'stt_checked_at', value: meeting.stt_checked_at ?? null },
  )
  if (!reclaimed) return BUSY
  return persistSoniox(ctx, meeting, deps)
}

async function persistSoniox(ctx: EngineContext, meeting: MeetingRow, deps: SttDeps): Promise<StepResult | null> {
  const soniox = sonioxFor(ctx, deps)
  const jobId = meeting.stt_job_id
  if (!soniox || !jobId) return failAndFallback(ctx, meeting, 'soniox_completed', 'not_configured', deps)

  const transcript = await withSonioxRetry(() => soniox.getTranscript(jobId), { sleep: deps.sleep })
  if (!transcript.ok) {
    if (transcript.retryable) return BUSY
    return failAndFallback(ctx, meeting, 'soniox_completed', `transcript_${transcript.code}`, deps)
  }
  const parts = await loadParts(ctx, meeting.id)
  const audioMs = meeting.stt_audio_ms || parts.reduce((sum, part) => sum + Math.max(0, part.duration_ms), 0)
  const problem = sonioxTranscriptProblem(transcript.data, audioMs)
  if (problem) {
    const context = await sonioxContextFor(ctx, meeting)
    const billed = estimateSonioxUsage({ audioMs, outputText: transcript.data.text, contextChars: sonioxContextChars(context) })
    return failAndFallback(ctx, meeting, 'soniox_completed', problem, deps, { ...billed, audioMs })
  }

  const tables = meetingTables(ctx.os)
  const scope = ctx.os === 'workspace' ? { workspace_id: meeting.workspace_id } : { user_id: meeting.user_id }
  const lines = sonioxTokensToLines(transcript.data.tokens, parts)

  const labels = [...new Set(lines.map((line) => line.speakerLabel))]
  const { data: existing, error: speakerError } = await ctx.client
    .from(tables.speakers)
    .select('id, label')
    .eq('meeting_id', meeting.id)
  if (speakerError) throw new Error(speakerError.message)
  const known = new Set(((existing ?? []) as Array<{ label: string }>).map((row) => row.label))
  const fresh = labels.filter((label) => !known.has(label))
  if (fresh.length) {
    const base = known.size
    const { error } = await ctx.client.from(tables.speakers).upsert(
      fresh.map((label, i) => ({ ...scope, meeting_id: meeting.id, label, ordinal: base + i })),
      { onConflict: 'meeting_id,label', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)
  }
  const { data: speakers, error: reloadError } = await ctx.client
    .from(tables.speakers)
    .select('id, label')
    .eq('meeting_id', meeting.id)
  if (reloadError) throw new Error(reloadError.message)
  const idByLabel = new Map(((speakers ?? []) as Array<{ id: string; label: string }>).map((s) => [s.label, s.id]))

  const removed = await ctx.client.from(tables.transcript).delete().eq('meeting_id', meeting.id)
  if (removed.error) throw new Error(removed.error.message)
  if (lines.length) {
    const rows = lines.map((line) => ({
      ...scope,
      meeting_id: meeting.id,
      audio_segment_id: line.audioSegmentId,
      speaker_id: idByLabel.get(line.speakerLabel) ?? null,
      ordinal: line.ordinal,
      start_ms: line.start_ms,
      end_ms: line.end_ms,
      text: line.text,
      language: line.language,
      languages: line.languages,
    }))
    const { error } = await ctx.client.from(tables.transcript).insert(rows)
    if (error) {
      console.error('meeting stt soniox save failed', { meetingId: meeting.id, detail: error.message.slice(0, 200) })
      return { ok: false, code: 'save_error', message: friendlyMeetingError('save_error'), status: 500 }
    }
  }

  const doneAt = new Date().toISOString()
  const marked = await ctx.client
    .from(tables.audio)
    .update({ status: 'transcribed', error: null, transcribed_at: doneAt })
    .eq('meeting_id', meeting.id)
  if (marked.error) throw new Error(marked.error.message)
  const completed = await transition(ctx, meeting.id, 'soniox_completed', {
    stt_state: 'completed',
    stt_provider: 'soniox',
    stt_model: SONIOX_ASYNC_MODEL,
    stt_completed_at: doneAt,
    processing_stage: null,
    processing_error: null,
  })
  if (!completed) return BUSY

  if (meeting.stt_usage_event_id) {
    const context = await sonioxContextFor(ctx, meeting)
    const usage = estimateSonioxUsage({
      audioMs,
      outputText: transcript.data.text,
      contextChars: sonioxContextChars(context),
    })
    await completeAiRequest(ctx.client, {
      eventId: meeting.stt_usage_event_id,
      status: 'completed',
      model: SONIOX_PRICING_MODEL,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      audioTokens: usage.audioTokens,
      audioMs,
      costUsd: usage.costUsd,
    })
  }
  // Results are stored in Hilm; the Soniox copy is deleted (privacy and the account job cap).
  await cleanupSoniox(ctx, deps, jobId, meeting.stt_file_id)
  return { ok: true, state: 'transcribed', more: true }
}

/**
 * Runs the transcription-routing part of advanceMeeting. Returns a StepResult when Soniox
 * handled this step, or null to continue on the existing Gemini per-part path (ctx.sttRoute
 * tells that path whether it is the fallback or the only provider).
 */
export async function meetingSttStep(
  ctx: EngineContext,
  meeting: MeetingRow,
  segments: SegmentSummary[],
  deps: SttDeps,
): Promise<StepResult | null> {
  if (!hasSttColumns(meeting)) {
    ctx.sttRoute = 'gemini_primary'
    return null
  }
  const state = (meeting.stt_state ?? null) as SttState | null
  if (state === 'gemini_fallback') return finishFallbackReset(ctx, meeting)
  if (state === 'gemini_processing' || state === 'completed' || state === 'failed') {
    ctx.sttRoute = geminiRouteFor(meeting)
    return null
  }
  if (state === null) {
    // Meetings already being transcribed per part (before Soniox) finish on that path.
    const started = segments.some((segment) => segment.status === 'transcribed' || segment.status === 'transcribing')
    if (started || !canSubmit(ctx)) {
      ctx.sttRoute = 'gemini_primary'
      return null
    }
  }

  // Soniox transcribes the finalized recording only — nothing runs while recording.
  if (meeting.status !== 'processing') return WAITING
  if (meeting.expected_segments === null || segments.length < meeting.expected_segments) return WAITING
  if (!segments.length && (state === null || state === 'pending')) {
    ctx.sttRoute = 'gemini_primary'
    return null
  }

  if (state === null || state === 'pending') return submitSoniox(ctx, meeting, deps)
  if (state === 'soniox_processing') return pollSoniox(ctx, meeting, deps)
  if (state === 'soniox_completed') return resumeSonioxPersist(ctx, meeting, deps)
  return startGeminiFallback(ctx, meeting)
}

/** The Gemini path finished every part: record the provider actually used. */
export async function markGeminiSttComplete(ctx: EngineContext, meeting: MeetingRow) {
  if (!hasSttColumns(meeting) || meeting.stt_state === 'completed') return
  const runtime = await loadEffectiveAiConfig(ctx.client)
  await ctx.client
    .from(meetingTables(ctx.os).meetings)
    .update({
      stt_state: 'completed',
      stt_provider: 'gemini',
      stt_model: runtime.models.meeting_transcription || MEETING_TRANSCRIBE_MODEL,
      stt_completed_at: new Date().toISOString(),
    })
    .eq('id', meeting.id)
}

/** Both providers failed for this meeting (the Gemini fallback exhausted its attempts). */
export async function markSttFailed(ctx: EngineContext, meetingId: string) {
  const { error } = await ctx.client
    .from(meetingTables(ctx.os).meetings)
    .update({ stt_state: 'failed' })
    .eq('id', meetingId)
    .in('stt_state', ['gemini_processing', 'gemini_fallback'])
  if (error && !/stt_state/i.test(error.message)) throw new Error(error.message)
}

/** Manual retry: a meeting without a finished transcript gets a fresh Soniox attempt. */
export function sttRetryPatch(ctx: EngineContext, meeting: MeetingRow): Record<string, unknown> | null {
  if (!hasSttColumns(meeting)) return null
  const state = meeting.stt_state ?? null
  // A running Soniox job keeps its state: resetting it would orphan the job and its ledger event.
  if (state !== 'failed' && state !== 'soniox_failed' && state !== 'gemini_processing' && state !== 'gemini_fallback') {
    return null
  }
  return {
    stt_state: ctx.sonioxKey ? 'pending' : null,
    stt_provider: null,
    stt_fallback: false,
    stt_job_id: null,
    stt_file_id: null,
    stt_usage_event_id: null,
    stt_upload_claimed_at: null,
    stt_submitted_at: null,
    stt_checked_at: null,
    stt_webhook_token_hash: null,
    stt_webhook_status: null,
    stt_webhook_at: null,
  }
}

// ── Background submission (meeting-stt-background) ──────────────────────────

async function joinMeetingAudio(
  ctx: EngineContext,
  parts: AudioPart[],
): Promise<{ file: Blob; hash: string; durationMs: number } | { error: string }> {
  const hash = createHash('sha256')
  const chunks: Blob[] = []
  let format: PcmFormat | null = null
  let bytes = 0
  for (const part of parts) {
    const download = await ctx.client.storage.from(MEETING_BUCKET).download(part.storage_path)
    if (download.error || !download.data) return { error: 'audio_missing' }
    const wav = parseWavPcm(new Uint8Array(await download.data.arrayBuffer()))
    if (!wav) return { error: 'audio_format' }
    if (!format) format = wav.format
    else if (!sameFormat(format, wav.format)) return { error: 'audio_format' }
    hash.update(wav.data)
    // Each part is copied into its own Blob so the downloaded buffer can be released.
    chunks.push(new Blob([wav.data as Uint8Array<ArrayBuffer>]))
    bytes += wav.data.byteLength
  }
  if (!format || !bytes) return { error: 'audio_empty' }
  const header = buildWavHeader(format, bytes) as Uint8Array<ArrayBuffer>
  return {
    file: new Blob([header, ...chunks], { type: 'audio/wav' }),
    hash: hash.digest('hex'),
    durationMs: pcmDurationMs(format, bytes),
  }
}

/**
 * Uploads the whole finalized meeting to Soniox and creates one transcription job. Runs in the
 * background function; exactly one invocation wins the upload claim. Failures are recorded as
 * soniox_failed so the next advance starts the Gemini fallback.
 */
export async function submitSonioxJob(
  ctx: EngineContext,
  meeting: MeetingRow,
  deps: Pick<SttDeps, 'soniox' | 'sleep'> = {},
): Promise<'submitted' | 'skipped' | 'failed'> {
  if (!hasSttColumns(meeting) || meeting.stt_state !== 'soniox_processing' || meeting.stt_job_id) return 'skipped'
  const fail = async (reason: string) => {
    await failSoniox(ctx, meeting, 'soniox_processing', reason, deps)
    return 'failed' as const
  }
  const soniox = sonioxFor(ctx, deps)
  if (!soniox || !ctx.origin) return fail('not_configured')

  const claimed = await transition(
    ctx,
    meeting.id,
    'soniox_processing',
    { stt_upload_claimed_at: new Date().toISOString() },
    { column: 'stt_upload_claimed_at', value: null },
  )
  if (!claimed) return 'skipped'

  try {
    const parts = await loadParts(ctx, meeting.id)
    const contiguous = parts.every((part, i) => part.idx === i)
    if (!parts.length || !contiguous || (meeting.expected_segments ?? parts.length) > parts.length) {
      return fail('audio_incomplete')
    }
    const audio = await joinMeetingAudio(ctx, parts)
    if ('error' in audio) return fail(audio.error)

    const reference = sonioxReference(ctx.os, meeting.id)
    const upload = await withSonioxRetry(() => soniox.uploadFile(audio.file, `hilm-meeting-${meeting.id}.wav`, reference), {
      sleep: deps.sleep,
    })
    if (!upload.ok) return fail(`upload_${upload.code}`)

    const token = randomBytes(32).toString('hex')
    await updateMeeting(ctx, meeting.id, {
      stt_file_id: upload.data.id,
      stt_audio_hash: audio.hash,
      stt_audio_ms: audio.durationMs,
      stt_webhook_token_hash: sha256Hex(token),
    })
    const withFile = { ...meeting, stt_file_id: upload.data.id }

    const context = await sonioxContextFor(ctx, meeting)
    const webhookUrl = `${ctx.origin}/api/meeting-stt-webhook?os=${ctx.os}&meeting=${meeting.id}`
    // Only HTTP-level failures are retried: a lost response may already have created the job.
    const created = await withSonioxRetry(
      () =>
        soniox.createTranscription({
          fileId: upload.data.id,
          context,
          languageHints: SONIOX_LANGUAGE_HINTS,
          webhookUrl,
          webhookAuthHeaderName: SONIOX_WEBHOOK_HEADER,
          webhookAuthHeaderValue: token,
          clientReferenceId: reference,
        }),
      { sleep: deps.sleep, retryIf: (failure) => failure.status !== null },
    )
    if (!created.ok) {
      await failSoniox(ctx, withFile, 'soniox_processing', `create_${created.code}`, deps)
      return 'failed'
    }

    const saved = await transition(
      ctx,
      meeting.id,
      'soniox_processing',
      { stt_job_id: created.data.id, stt_submitted_at: new Date().toISOString(), stt_checked_at: null },
      { column: 'stt_job_id', value: null },
    )
    if (!saved) {
      // The meeting moved on (e.g. timed out to the fallback) while we were uploading.
      await cleanupSoniox(ctx, deps, created.data.id, upload.data.id)
      return 'skipped'
    }
    return 'submitted'
  } catch (error) {
    console.error('meeting stt soniox submit error', {
      meetingId: meeting.id,
      detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    })
    return fail('submit_error')
  }
}
