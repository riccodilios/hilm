import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { getAppUrl } from '@/lib/env'
import type {
  CreateMeetingInput,
  Meeting,
  MeetingActionItem,
  MeetingAudioPart,
  MeetingDecision,
  MeetingDetail,
  MeetingOs,
  MeetingScope,
  MeetingSpeaker,
  MeetingTranscriptSegment,
} from './types'

export const MEETING_AUDIO_BUCKET = 'meeting-audio'

/** Table names differ per OS; rows are mapped into shared domain types below. */
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

const db = supabase as unknown as SupabaseClient

export const meetingKeys = {
  all: ['meetings'] as const,
  list: (scope: Pick<MeetingScope, 'os' | 'projectId'>) => ['meetings', scope.os, 'list', scope.projectId] as const,
  detail: (os: MeetingOs, meetingId: string) => ['meetings', os, 'detail', meetingId] as const,
  linkedTasks: (os: MeetingOs, meetingId: string) => ['meetings', os, 'tasks', meetingId] as const,
  quota: () => ['meetings', 'quota'] as const,
}

type Row = Record<string, unknown>

const str = (value: unknown) => (typeof value === 'string' ? value : null)
const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const strArr = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

function countFrom(value: unknown) {
  if (Array.isArray(value) && value[0] && typeof value[0] === 'object') return num((value[0] as Row).count)
  return 0
}

export function mapMeeting(row: Row, os: MeetingOs): Meeting {
  const tables = meetingTables(os)
  return {
    id: String(row.id),
    projectId: str(row.project_id),
    title: String(row.title ?? ''),
    description: str(row.description),
    status: (str(row.status) ?? 'draft') as Meeting['status'],
    heldAt: str(row.held_at),
    startedAt: str(row.started_at),
    endedAt: str(row.ended_at),
    durationSeconds: num(row.duration_seconds),
    language: str(row.language),
    participants: strArr(row.participants),
    summary: str(row.summary),
    keyPoints: strArr(row.key_points),
    processingStage: str(row.processing_stage),
    processingError: str(row.processing_error),
    processingAttempts: num(row.processing_attempts),
    expectedSegments: typeof row.expected_segments === 'number' ? row.expected_segments : null,
    analyzedAt: str(row.analyzed_at),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    createdBy: str(os === 'workspace' ? row.created_by : row.user_id),
    actionItemCount: countFrom(row[tables.actions]),
  }
}

function mapSpeaker(row: Row): MeetingSpeaker {
  return {
    id: String(row.id),
    label: String(row.label ?? ''),
    displayName: str(row.display_name),
    description: str(row.description),
    ordinal: num(row.ordinal),
    linkedUserId: str(row.linked_user_id),
  }
}

function mapTranscript(row: Row): MeetingTranscriptSegment {
  return {
    id: String(row.id),
    audioSegmentId: str(row.audio_segment_id),
    speakerId: str(row.speaker_id),
    ordinal: num(row.ordinal),
    startMs: num(row.start_ms),
    endMs: num(row.end_ms),
    text: String(row.text ?? ''),
    language: str(row.language),
    languages: strArr(row.languages),
  }
}

function mapDecision(row: Row): MeetingDecision {
  return {
    id: String(row.id),
    text: String(row.text ?? ''),
    certainty: row.certainty === 'confirmed' ? 'confirmed' : 'uncertain',
    sourceSegmentIds: strArr(row.source_segment_ids),
    ordinal: num(row.ordinal),
  }
}

function mapActionItem(row: Row): MeetingActionItem {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    description: str(row.description),
    ownerSpeakerId: str(row.owner_speaker_id),
    ownerCertainty: (str(row.owner_certainty) ?? 'none') as MeetingActionItem['ownerCertainty'],
    dueText: str(row.due_text),
    dueDate: str(row.due_date),
    priority: (str(row.priority) as MeetingActionItem['priority']) ?? null,
    certainty: row.certainty === 'confirmed' ? 'confirmed' : 'possible',
    sourceSegmentIds: strArr(row.source_segment_ids),
    ordinal: num(row.ordinal),
    taskId: str(row.task_id),
  }
}

function mapAudio(row: Row): MeetingAudioPart {
  return {
    id: String(row.id),
    idx: num(row.idx),
    storagePath: String(row.storage_path ?? ''),
    offsetMs: num(row.offset_ms),
    durationMs: num(row.duration_ms),
    status: (str(row.status) ?? 'uploaded') as MeetingAudioPart['status'],
    error: str(row.error),
  }
}

function scopeColumns(scope: MeetingScope) {
  if (scope.os === 'workspace') {
    if (!scope.workspaceId) throw new Error('Workspace is required')
    return { workspace_id: scope.workspaceId }
  }
  return { user_id: scope.userId }
}

export async function listMeetings(scope: MeetingScope): Promise<Meeting[]> {
  const tables = meetingTables(scope.os)
  let query = db
    .from(tables.meetings)
    .select(`*, ${tables.actions}(count)`)
    .eq('project_id', scope.projectId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (scope.os === 'workspace' && scope.workspaceId) query = query.eq('workspace_id', scope.workspaceId)
  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as Row[]).map((row) => mapMeeting(row, scope.os))
}

const TRANSCRIPT_PAGE = 1000

/** PostgREST caps responses (1000 rows by default); long meetings exceed that. */
async function fetchTranscriptRows(table: string, meetingId: string): Promise<{ data: Row[]; error: null } | { data: null; error: unknown }> {
  const rows: Row[] = []
  for (let from = 0; from < 20 * TRANSCRIPT_PAGE; from += TRANSCRIPT_PAGE) {
    const { data, error } = await db
      .from(table)
      .select('*')
      .eq('meeting_id', meetingId)
      .order('ordinal')
      .range(from, from + TRANSCRIPT_PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < TRANSCRIPT_PAGE) break
  }
  return { data: rows, error: null }
}

export async function getMeetingTitle(os: MeetingOs, meetingId: string) {
  const { data, error } = await db
    .from(meetingTables(os).meetings)
    .select('title, project_id')
    .eq('id', meetingId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as { title: string; project_id: string | null }
  return { title: row.title, projectId: row.project_id }
}

export async function getMeetingDetail(os: MeetingOs, meetingId: string): Promise<MeetingDetail | null> {
  const tables = meetingTables(os)
  const { data: meetingRow, error } = await db
    .from(tables.meetings)
    .select(`*, ${tables.actions}(count)`)
    .eq('id', meetingId)
    .maybeSingle()
  if (error) throw error
  if (!meetingRow) return null

  const [speakers, transcript, decisions, actions, audio] = await Promise.all([
    db.from(tables.speakers).select('*').eq('meeting_id', meetingId).order('ordinal'),
    fetchTranscriptRows(tables.transcript, meetingId),
    db.from(tables.decisions).select('*').eq('meeting_id', meetingId).order('ordinal'),
    db.from(tables.actions).select('*').eq('meeting_id', meetingId).order('ordinal'),
    db
      .from(tables.audio)
      .select('id, idx, storage_path, offset_ms, duration_ms, status, error')
      .eq('meeting_id', meetingId)
      .order('idx'),
  ])
  for (const result of [speakers, transcript, decisions, actions, audio]) {
    if (result.error) throw result.error
  }
  return {
    meeting: mapMeeting(meetingRow as Row, os),
    speakers: ((speakers.data ?? []) as Row[]).map(mapSpeaker),
    transcript: ((transcript.data ?? []) as Row[]).map(mapTranscript),
    decisions: ((decisions.data ?? []) as Row[]).map(mapDecision),
    actionItems: ((actions.data ?? []) as Row[]).map(mapActionItem),
    audio: ((audio.data ?? []) as Row[]).map(mapAudio),
  }
}

export async function createMeeting(scope: MeetingScope, input: CreateMeetingInput): Promise<Meeting> {
  const tables = meetingTables(scope.os)
  const title = input.title.trim()
  if (!title) throw new Error('Title is required')
  const payload: Row = {
    ...scopeColumns(scope),
    project_id: scope.projectId,
    title: title.slice(0, 200),
    description: input.description?.trim() || null,
    held_at: input.heldAt ?? new Date().toISOString(),
    participants: (input.participants ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 50),
    status: 'draft',
  }
  if (scope.os === 'workspace') payload.created_by = scope.userId
  const { data, error } = await db.from(tables.meetings).insert(payload).select('*').single()
  if (error) throw error
  return mapMeeting(data as Row, scope.os)
}

export type MeetingPatch = Partial<{
  title: string
  description: string | null
  heldAt: string | null
  participants: string[]
  summary: string | null
  keyPoints: string[]
}>

export async function updateMeeting(os: MeetingOs, meetingId: string, patch: MeetingPatch) {
  const tables = meetingTables(os)
  const row: Row = {}
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) throw new Error('Title is required')
    row.title = title.slice(0, 200)
  }
  if (patch.description !== undefined) row.description = patch.description?.trim() || null
  if (patch.heldAt !== undefined) row.held_at = patch.heldAt
  if (patch.participants !== undefined) row.participants = patch.participants.map((p) => p.trim()).filter(Boolean)
  if (patch.summary !== undefined) row.summary = patch.summary
  if (patch.keyPoints !== undefined) row.key_points = patch.keyPoints
  const { error } = await db.from(tables.meetings).update(row).eq('id', meetingId)
  if (error) throw error
}

/** Deletes the meeting, its derived rows (cascade) and its private audio objects. */
export async function deleteMeeting(os: MeetingOs, meetingId: string) {
  const tables = meetingTables(os)
  const { data: parts } = await db.from(tables.audio).select('storage_path').eq('meeting_id', meetingId)
  const paths = ((parts ?? []) as Row[]).map((row) => String(row.storage_path)).filter(Boolean)
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(MEETING_AUDIO_BUCKET).remove(paths)
    if (storageError) throw storageError
  }
  const { error } = await db.from(tables.meetings).delete().eq('id', meetingId)
  if (error) throw error
}

/** Marks recording as finished so the server can transcribe remaining parts and analyse. */
export async function finalizeRecording(
  os: MeetingOs,
  meetingId: string,
  input: { expectedSegments: number; durationSeconds: number },
) {
  const tables = meetingTables(os)
  const now = new Date().toISOString()
  const row: Row =
    input.expectedSegments > 0
      ? {
          status: 'processing',
          expected_segments: input.expectedSegments,
          duration_seconds: Math.max(0, Math.round(input.durationSeconds)),
          ended_at: now,
          processing_stage: null,
          processing_error: null,
        }
      : { status: 'draft', expected_segments: null }
  const { error } = await db.from(tables.meetings).update(row).eq('id', meetingId)
  if (error) throw error
}

export async function updateSpeaker(
  os: MeetingOs,
  speakerId: string,
  patch: { displayName?: string | null; linkedUserId?: string | null },
) {
  const tables = meetingTables(os)
  const row: Row = {}
  if (patch.displayName !== undefined) row.display_name = patch.displayName?.trim() || null
  if (os === 'workspace' && patch.linkedUserId !== undefined) row.linked_user_id = patch.linkedUserId
  const { error } = await db.from(tables.speakers).update(row).eq('id', speakerId)
  if (error) throw error
}

/** Merge a mis-split speaker into another: transcript and owners move, the duplicate is removed. */
export async function mergeSpeakers(os: MeetingOs, meetingId: string, fromId: string, intoId: string) {
  if (fromId === intoId) return
  const tables = meetingTables(os)
  const moved = await db
    .from(tables.transcript)
    .update({ speaker_id: intoId })
    .eq('meeting_id', meetingId)
    .eq('speaker_id', fromId)
  if (moved.error) throw moved.error
  const owners = await db
    .from(tables.actions)
    .update({ owner_speaker_id: intoId })
    .eq('meeting_id', meetingId)
    .eq('owner_speaker_id', fromId)
  if (owners.error) throw owners.error
  const removed = await db.from(tables.speakers).delete().eq('id', fromId)
  if (removed.error) throw removed.error
}

export type ActionItemPatch = Partial<{
  title: string
  description: string | null
  ownerSpeakerId: string | null
  dueDate: string | null
  priority: MeetingActionItem['priority']
}>

export async function updateActionItem(os: MeetingOs, itemId: string, patch: ActionItemPatch) {
  const tables = meetingTables(os)
  const row: Row = {}
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) throw new Error('Title is required')
    row.title = title.slice(0, 300)
  }
  if (patch.description !== undefined) row.description = patch.description?.trim() || null
  if (patch.ownerSpeakerId !== undefined) {
    row.owner_speaker_id = patch.ownerSpeakerId
    row.owner_certainty = patch.ownerSpeakerId ? 'confirmed' : 'none'
  }
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate
  if (patch.priority !== undefined) row.priority = patch.priority
  const { error } = await db.from(tables.actions).update(row).eq('id', itemId)
  if (error) throw error
}

export async function deleteActionItem(os: MeetingOs, itemId: string) {
  const { error } = await db.from(meetingTables(os).actions).delete().eq('id', itemId)
  if (error) throw error
}

export async function linkActionItemToTask(os: MeetingOs, itemId: string, taskId: string) {
  const { error } = await db.from(meetingTables(os).actions).update({ task_id: taskId }).eq('id', itemId)
  if (error) throw error
}

// ── Audio upload + processing ───────────────────────────────────────────────

export function meetingStoragePath(scope: Pick<MeetingScope, 'os' | 'userId' | 'workspaceId'>, meetingId: string, idx: number) {
  const file = `${String(idx).padStart(4, '0')}.wav`
  if (scope.os === 'workspace') return `workspace/${scope.workspaceId}/${meetingId}/${file}`
  return `${scope.userId}/${meetingId}/${file}`
}

export type RegisterResult = { ok: true; segmentId: string } | { ok: false; code: string; message: string }

export async function uploadMeetingSegment(input: {
  os: MeetingOs
  meetingId: string
  idx: number
  storagePath: string
  offsetMs: number
  durationMs: number
  wav: Blob
}): Promise<RegisterResult> {
  const upload = await supabase.storage
    .from(MEETING_AUDIO_BUCKET)
    .upload(input.storagePath, input.wav, { contentType: 'audio/wav', upsert: true })
  if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error

  const { data, error } = await supabase.rpc('register_meeting_segment', {
    p_os: input.os,
    p_meeting_id: input.meetingId,
    p_idx: input.idx,
    p_storage_path: input.storagePath,
    p_duration_ms: Math.round(input.durationMs),
    p_offset_ms: Math.round(input.offsetMs),
    p_mime: 'audio/wav',
    p_byte_size: input.wav.size,
  })
  if (error) throw error
  const result = (data ?? {}) as { ok?: boolean; segment_id?: string; code?: string; message?: string }
  if (result.ok && result.segment_id) return { ok: true, segmentId: result.segment_id }
  if (result.ok) return { ok: true, segmentId: '' }
  return { ok: false, code: result.code ?? 'register_failed', message: result.message ?? 'Could not save audio' }
}

function meetingProcessUrl() {
  if (typeof window !== 'undefined') {
    const origin = window.location.origin.replace(/\/$/, '')
    if (!/localhost|127\.0\.0\.1/i.test(origin)) return `${origin}/api/meeting-process`
  }
  const app = getAppUrl()
  if (app && !/localhost|127\.0\.0\.1/i.test(app)) return `${app.replace(/\/$/, '')}/api/meeting-process`
  return '/.netlify/functions/meeting-process'
}

export type ProcessResponse =
  | { ok: true; state: 'transcribed' | 'analyzed' | 'idle' | 'waiting' | 'busy'; more: boolean }
  | { ok: false; code: string; error: string }

export async function callMeetingProcess(
  body:
    | { action: 'transcribe_segment'; os: MeetingOs; meetingId: string; idx: number; locale?: string; timeZone?: string }
    | { action: 'advance' | 'retry'; os: MeetingOs; meetingId: string; locale?: string; timeZone?: string },
): Promise<ProcessResponse> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, code: 'unauthorized', error: 'Please sign in again.' }
  let response: Response
  try {
    const timeZone =
      body.timeZone ||
      (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined)
    response = await fetch(meetingProcessUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, timeZone }),
    })
  } catch {
    return { ok: false, code: 'network', error: 'Network error. Processing will continue automatically.' }
  }
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; state?: string; more?: boolean; code?: string; error?: string }
    | null
  if (response.ok && payload?.ok) {
    return { ok: true, state: (payload.state ?? 'idle') as 'idle', more: Boolean(payload.more) }
  }
  return {
    ok: false,
    code: payload?.code ?? `http_${response.status}`,
    error: payload?.error ?? 'Processing failed',
  }
}

export async function getMeetingAudioUrl(storagePath: string) {
  const { data, error } = await supabase.storage.from(MEETING_AUDIO_BUCKET).createSignedUrl(storagePath, 60 * 30)
  if (error) throw error
  return data.signedUrl
}

export type MeetingQuota = {
  tier: string
  enabled: boolean
  maxMinutes: number
  minutesPerMonth: number
  usedMinutesMonth: number
  maxRetries: number
}

export async function getMeetingQuota(): Promise<MeetingQuota | null> {
  const { data, error } = await supabase.rpc('meeting_quota_status', {})
  if (error || !data) return null
  const row = data as Row
  return {
    tier: String(row.tier ?? 'free'),
    enabled: Boolean(row.enabled),
    maxMinutes: num(row.max_minutes, 60),
    minutesPerMonth: num(row.minutes_per_month, 300),
    usedMinutesMonth: num(row.used_minutes_month),
    maxRetries: num(row.max_retries, 3),
  }
}
