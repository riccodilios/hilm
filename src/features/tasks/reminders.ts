import type { Tables } from '@/types/database'

export type ReminderType =
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | 'same_day_morning'
  | '1d'
  | '2d'
  | '1w'
  | 'custom'

export const REMINDER_OPTIONS: { value: ReminderType; labelKey: string }[] = [
  { value: '5m', labelKey: 'reminders.5m' },
  { value: '15m', labelKey: 'reminders.15m' },
  { value: '30m', labelKey: 'reminders.30m' },
  { value: '1h', labelKey: 'reminders.1h' },
  { value: 'same_day_morning', labelKey: 'reminders.sameDayMorning' },
  { value: '1d', labelKey: 'reminders.1d' },
  { value: '2d', labelKey: 'reminders.2d' },
  { value: '1w', labelKey: 'reminders.1w' },
  { value: 'custom', labelKey: 'reminders.custom' },
]

export type TaskWithProject = Tables<'tasks'> & {
  projects?: Pick<Tables<'projects'>, 'id' | 'name' | 'color' | 'icon'> | null
}

export function combineDueAt(dueDate?: string | null, dueTime?: string | null): string | null {
  if (!dueDate) return null
  const time = dueTime && dueTime.length >= 4 ? dueTime.slice(0, 8) : '09:00:00'
  const iso = new Date(`${dueDate}T${time.length === 5 ? `${time}:00` : time}`)
  if (Number.isNaN(iso.getTime())) return null
  return iso.toISOString()
}

export function computeRemindAt(
  dueAt: string | null | undefined,
  reminderType: ReminderType,
  customAt?: string | null,
): string | null {
  if (reminderType === 'custom') return customAt ?? null
  if (!dueAt) return null
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null

  const clone = new Date(due)
  switch (reminderType) {
    case '5m':
      clone.setMinutes(clone.getMinutes() - 5)
      break
    case '15m':
      clone.setMinutes(clone.getMinutes() - 15)
      break
    case '30m':
      clone.setMinutes(clone.getMinutes() - 30)
      break
    case '1h':
      clone.setHours(clone.getHours() - 1)
      break
    case 'same_day_morning':
      clone.setHours(9, 0, 0, 0)
      break
    case '1d':
      clone.setDate(clone.getDate() - 1)
      break
    case '2d':
      clone.setDate(clone.getDate() - 2)
      break
    case '1w':
      clone.setDate(clone.getDate() - 7)
      break
    default:
      return null
  }
  return clone.toISOString()
}
