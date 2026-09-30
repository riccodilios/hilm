import { createContext, useContext } from 'react'
import type { MeetingOs } from '../types'
import type { CaptureErrorCode, CaptureMode } from './capture'

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finishing'

export type RecorderSession = {
  os: MeetingOs
  meetingId: string
  title: string
  href: string
  storagePathFor: (idx: number) => string
  startIdx: number
  startOffsetMs: number
  /** Plan limit for a single meeting; recording stops automatically at this length. */
  maxMs: number | null
  /** How audio is captured for this session. Defaults to mic-only when omitted. */
  captureMode: CaptureMode
  locale?: string
}

export type RecorderErrorCode =
  | CaptureErrorCode
  | 'meeting_too_long'
  | 'monthly_meeting_limit'
  | 'tier_disabled'
  | 'upload_failed'

export type RecorderNotice = 'interrupted' | 'device_lost' | 'display_ended' | 'limit_reached' | null

export type PersistedSession = { os: MeetingOs; meetingId: string; title: string; href: string; startedAt: number }

export type RecorderState = {
  status: RecorderStatus
  session: RecorderSession | null
  elapsedMs: number
  level: number
  notice: RecorderNotice
  error: { code: RecorderErrorCode; message?: string } | null
  pendingUploads: number
  /** A recording that was cut off by a reload or crash (meeting is still "recording"). */
  interrupted: PersistedSession | null
}

export type RecorderApi = RecorderState & {
  start: (session: RecorderSession) => Promise<boolean>
  pause: () => void
  resume: () => Promise<void>
  stop: () => Promise<void>
  /** Swap mic ↔ tab+mic mid-meeting without ending the session. */
  setCaptureMode: (mode: CaptureMode) => Promise<boolean>
  clearError: () => void
  clearInterrupted: () => void
  isActiveFor: (meetingId: string) => boolean
  driveProcessing: (os: MeetingOs, meetingId: string, locale?: string) => void
}

export const RecorderContext = createContext<RecorderApi | null>(null)

export function useMeetingRecorder() {
  const context = useContext(RecorderContext)
  if (!context) throw new Error('useMeetingRecorder must be used inside MeetingRecorderProvider')
  return context
}
