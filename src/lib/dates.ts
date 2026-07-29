/** Local calendar-day helpers — never use UTC date slices for due dates. */

export function toLocalDateKey(input?: string | Date | null): string | null {
  if (input == null || input === '') return null
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim().slice(0, 10)
  }
  const date = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayLocalISO() {
  return toLocalDateKey(new Date())!
}

export function addLocalDays(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return toLocalDateKey(date)!
}

export function taskDueDateKey(task: {
  due_date?: string | null
  due_at?: string | null
}): string | null {
  if (task.due_date) {
    const key = toLocalDateKey(task.due_date.slice(0, 10))
    if (key) return key
  }
  return toLocalDateKey(task.due_at)
}

/** Local due instant for remaining-time labels (date-only dues use 09:00 local). */
export function taskDueInstant(task: {
  due_date?: string | null
  due_at?: string | null
}): Date | null {
  const key = taskDueDateKey(task)
  if (!key) return null
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 9, 0, 0, 0)
}

export function formatDueRemaining(
  task: { due_date?: string | null; due_at?: string | null },
  opts?: { now?: Date; locale?: string },
): string {
  const due = taskDueInstant(task)
  if (!due) return ''
  const now = opts?.now ?? new Date()
  const locale = opts?.locale?.startsWith('ar') ? 'ar' : 'en'
  const diffMs = due.getTime() - now.getTime()
  const abs = Math.abs(diffMs)
  const mins = Math.round(abs / 60_000)
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  const days = Math.floor(hours / 24)

  const dueKey = toLocalDateKey(due)!
  const todayKey = toLocalDateKey(now)!
  const tomorrowKey = addLocalDays(todayKey, 1)

  if (dueKey === tomorrowKey && diffMs > 0) {
    return locale === 'ar' ? 'غداً الساعة 9:00 ص' : 'Tomorrow at 9:00 AM'
  }

  if (diffMs < 0) {
    if (days >= 1) return locale === 'ar' ? `متأخر ${days}ي` : `Overdue by ${days}d`
    if (hours >= 1) return locale === 'ar' ? `متأخر ${hours}س` : `Overdue by ${hours}h`
    return locale === 'ar' ? `متأخر ${Math.max(1, mins)}د` : `Overdue by ${Math.max(1, mins)}m`
  }

  if (days >= 2) {
    return locale === 'ar'
      ? due.toLocaleDateString('ar', { month: 'short', day: 'numeric' })
      : due.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  }
  if (hours >= 24) return locale === 'ar' ? 'غداً الساعة 9:00 ص' : 'Tomorrow at 9:00 AM'
  if (hours >= 1) {
    return locale === 'ar'
      ? `متبقي ${hours}س ${remMins}د`
      : `Due in ${hours}h ${remMins}m`
  }
  return locale === 'ar' ? `متبقي ${Math.max(1, mins)}د` : `Due in ${Math.max(1, mins)}m`
}
