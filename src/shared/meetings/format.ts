import type { Meeting, MeetingActionItem, MeetingSpeaker } from './types'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Task description for a task created from an action item; uncertain facts stay labelled as such. */
export function buildActionTaskDescription(input: {
  item: MeetingActionItem
  meeting: Meeting
  ownerName: string | null
  t: Translate
}) {
  const { item, meeting, ownerName, t } = input
  const lines: string[] = []
  if (item.description?.trim()) lines.push(item.description.trim(), '')
  if (ownerName) {
    lines.push(
      item.ownerCertainty === 'confirmed'
        ? t('meetings.taskNote.owner', { name: ownerName })
        : t('meetings.taskNote.ownerUncertain', { name: ownerName }),
    )
  }
  if (item.dueText) lines.push(t('meetings.taskNote.due', { text: item.dueText }))
  if (item.certainty === 'possible') lines.push(t('meetings.taskNote.possible'))
  lines.push(t('meetings.taskNote.source', { title: meeting.title }))
  return lines.join('\n')
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

export function formatDurationShort(seconds: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const minutes = Math.round(seconds / 60)
  if (seconds > 0 && minutes < 1) return t('meetings.duration.underMinute')
  if (minutes < 60) return t('meetings.duration.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest
    ? t('meetings.duration.hoursMinutes', { hours, minutes: rest })
    : t('meetings.duration.hours', { count: hours })
}

export function speakerName(speaker: MeetingSpeaker | undefined | null, fallback: string) {
  if (!speaker) return fallback
  return speaker.displayName?.trim() || speaker.label
}

/** Stable per-speaker accent so the same speaker keeps its colour across the transcript. */
const SPEAKER_TONES = [
  'text-sky-300 bg-sky-500/10',
  'text-violet-300 bg-violet-500/10',
  'text-emerald-300 bg-emerald-500/10',
  'text-amber-300 bg-amber-500/10',
  'text-rose-300 bg-rose-500/10',
  'text-cyan-300 bg-cyan-500/10',
]

export function speakerTone(ordinal: number) {
  return SPEAKER_TONES[Math.abs(ordinal) % SPEAKER_TONES.length]!
}

/** Text direction for mixed Arabic/English transcript lines. */
export function textDirection(text: string): 'rtl' | 'ltr' {
  const arabic = text.match(/[\u0600-\u06FF]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0
  return arabic > latin ? 'rtl' : 'ltr'
}
