import type { MeetingAudioStatus, MeetingStatus } from '@/types/database'

export type MeetingOs = 'personal' | 'workspace'
export type { MeetingStatus, MeetingAudioStatus }

export type MeetingScope = {
  os: MeetingOs
  userId: string
  projectId: string
  /** Required when os === 'workspace'. */
  workspaceId?: string | null
}

export type Meeting = {
  id: string
  projectId: string | null
  title: string
  description: string | null
  status: MeetingStatus
  heldAt: string | null
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number
  language: string | null
  participants: string[]
  summary: string | null
  keyPoints: string[]
  processingStage: string | null
  processingError: string | null
  processingAttempts: number
  expectedSegments: number | null
  analyzedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  actionItemCount: number
}

export type MeetingSpeaker = {
  id: string
  label: string
  displayName: string | null
  description: string | null
  ordinal: number
  linkedUserId: string | null
}

export type MeetingTranscriptSegment = {
  id: string
  audioSegmentId: string | null
  speakerId: string | null
  ordinal: number
  startMs: number
  endMs: number
  text: string
  /** Detected spoken language for this segment (language_code): en, ar, ar-SA, ar-LB, … */
  language: string | null
}

export type MeetingDecision = {
  id: string
  text: string
  certainty: 'confirmed' | 'uncertain'
  sourceSegmentIds: string[]
  ordinal: number
}

export type MeetingActionItem = {
  id: string
  title: string
  description: string | null
  ownerSpeakerId: string | null
  ownerCertainty: 'confirmed' | 'uncertain' | 'none'
  dueText: string | null
  dueDate: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent' | null
  certainty: 'confirmed' | 'possible'
  sourceSegmentIds: string[]
  ordinal: number
  taskId: string | null
}

export type MeetingAudioPart = {
  id: string
  idx: number
  storagePath: string
  offsetMs: number
  durationMs: number
  status: MeetingAudioStatus
  error: string | null
}

export type LinkedTask = {
  id: string
  title: string
  status: string
  sourceActionItemId: string | null
}

export type MeetingDetail = {
  meeting: Meeting
  speakers: MeetingSpeaker[]
  transcript: MeetingTranscriptSegment[]
  decisions: MeetingDecision[]
  actionItems: MeetingActionItem[]
  audio: MeetingAudioPart[]
}

export type MeetingMember = { id: string; name: string }

/** OS-specific task integration supplied by the Personal / Workspace adapters. */
export type MeetingTaskBridge = {
  createTaskFromActionItem: (input: {
    meeting: Meeting
    item: MeetingActionItem
    ownerName: string | null
    ownerUserId: string | null
  }) => Promise<{ taskId: string; existed: boolean }>
  listTasksForMeeting: (meetingId: string) => Promise<LinkedTask[]>
  taskHref: (taskId: string) => string
  /** Query keys to invalidate after tasks are created. */
  invalidateKeys: ReadonlyArray<readonly unknown[]>
}

export type MeetingsAdapter = {
  scope: MeetingScope
  projectName: string
  canEdit: boolean
  canDelete: (meeting: Meeting) => boolean
  meetingHref: (meetingId: string) => string
  listHref: string
  tasks: MeetingTaskBridge
  members?: MeetingMember[]
  userDisplayName?: string
  workspaceName?: string | null
}

export type CreateMeetingInput = {
  title: string
  description?: string | null
  heldAt?: string | null
  participants?: string[]
}
