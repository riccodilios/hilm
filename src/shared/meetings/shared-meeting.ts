import type { MeetingDetail, MeetingStatus } from './types'

/** Path of the public, sign-in-free meeting page. */
export const SHARED_MEETING_PATH = '/shared/meeting'

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function sharedMeetingUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}${SHARED_MEETING_PATH}/${token}`
}

type Row = Record<string, unknown>
const str = (value: unknown) => (typeof value === 'string' ? value : null)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const strArr = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
const rows = (value: unknown) => (Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Row[]) : [])
const STATUSES = new Set<MeetingStatus>(['draft', 'recording', 'processing', 'ready', 'failed'])

/**
 * Maps the public share payload into the shared meeting domain shape so the regular read-only
 * components can render it. Fields the payload never contains (notes, task links, audio,
 * processing internals) are left empty.
 */
export function mapSharedMeeting(payload: unknown): MeetingDetail | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Row
  const meeting = root.meeting
  if (!meeting || typeof meeting !== 'object') return null
  const m = meeting as Row
  const status = STATUSES.has(m.status as MeetingStatus) ? (m.status as MeetingStatus) : 'ready'
  const heldAt = str(m.held_at)
  const actionItems = rows(root.action_items)
  return {
    meeting: {
      id: 'shared',
      projectId: null,
      title: String(m.title ?? ''),
      description: null,
      status,
      heldAt,
      startedAt: heldAt,
      endedAt: null,
      durationSeconds: num(m.duration_seconds),
      language: str(m.language),
      participants: strArr(m.participants),
      summary: str(m.summary),
      keyPoints: strArr(m.key_points),
      processingStage: null,
      processingError: null,
      processingAttempts: 0,
      expectedSegments: null,
      analyzedAt: null,
      createdAt: heldAt ?? '',
      updatedAt: heldAt ?? '',
      createdBy: null,
      actionItemCount: actionItems.length,
      sttWindow: null,
      sttWindowCount: null,
      shareEnabledAt: str(m.shared_at),
      shareTokenHash: null,
    },
    speakers: rows(root.speakers).map((row) => ({
      id: String(row.id),
      label: String(row.label ?? ''),
      displayName: str(row.display_name),
      description: null,
      ordinal: num(row.ordinal),
      linkedUserId: null,
    })),
    transcript: rows(root.transcript).map((row) => ({
      id: String(row.id),
      audioSegmentId: null,
      speakerId: str(row.speaker_id),
      ordinal: num(row.ordinal),
      startMs: num(row.start_ms),
      endMs: num(row.end_ms),
      text: String(row.text ?? ''),
      language: str(row.language),
      languages: strArr(row.languages),
    })),
    decisions: rows(root.decisions).map((row) => ({
      id: String(row.id),
      text: String(row.text ?? ''),
      certainty: row.certainty === 'confirmed' ? 'confirmed' : 'uncertain',
      sourceSegmentIds: strArr(row.source_segment_ids),
      ordinal: num(row.ordinal),
    })),
    actionItems: actionItems.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ''),
      description: str(row.description),
      ownerSpeakerId: str(row.owner_speaker_id),
      ownerCertainty: (str(row.owner_certainty) ?? 'none') as 'confirmed' | 'uncertain' | 'none',
      dueText: str(row.due_text),
      dueDate: str(row.due_date),
      priority: (str(row.priority) as MeetingDetail['actionItems'][number]['priority']) ?? null,
      certainty: row.certainty === 'confirmed' ? 'confirmed' : 'possible',
      sourceSegmentIds: strArr(row.source_segment_ids),
      ordinal: num(row.ordinal),
      taskId: null,
    })),
    audio: [],
  }
}

/** Only same-origin in-app meeting paths are followed after resolving a share link. */
export function isSafeMeetingAppHref(href: unknown): href is string {
  return (
    typeof href === 'string' &&
    (/^\/personal\/projects\/[0-9a-f-]{36}\/meetings\/[0-9a-f-]{36}$/.test(href) ||
      /^\/workspace\/[0-9a-f-]{36}\/projects\/[0-9a-f-]{36}\/meetings\/[0-9a-f-]{36}$/.test(href))
  )
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
