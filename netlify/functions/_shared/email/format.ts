/** Locale/time-zone aware formatting for email content. */
import type { EmailLocale } from './layout.ts'

export type Recipient = {
  locale: EmailLocale
  timeZone: string | null
  timeFormat: '12h' | '24h'
}

export function normalizeLocale(value: unknown): EmailLocale {
  return typeof value === 'string' && value.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

export function safeTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 64) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return null
  }
}

const intlLocale = (locale: EmailLocale) => (locale === 'ar' ? 'ar-u-nu-latn' : 'en-US')

/** "Fri, Oct 30, 3:00 PM" in the recipient's zone; UTC (labelled) when the zone is unknown. */
export function formatDateTime(iso: string, recipient: Recipient) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const zone = safeTimeZone(recipient.timeZone)
  const text = new Intl.DateTimeFormat(intlLocale(recipient.locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: recipient.timeFormat === '12h' ? 'h12' : 'h23',
    timeZone: zone ?? 'UTC',
  }).format(date)
  return zone ? text : `${text} UTC`
}

/** Calendar date (YYYY-MM-DD) without any time-zone shift. */
export function formatDateOnly(day: string, locale: EmailLocale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function formatDue(
  due: { dueAt?: string | null; dueDate?: string | null; dueTime?: string | null },
  recipient: Recipient,
): string | null {
  if (due.dueAt) return formatDateTime(due.dueAt, recipient)
  if (!due.dueDate) return null
  const day = formatDateOnly(due.dueDate.slice(0, 10), recipient.locale)
  if (!day) return null
  const time = due.dueTime && /^\d{2}:\d{2}/.test(due.dueTime) ? due.dueTime.slice(0, 5) : null
  return time ? `${day}, ${time}` : day
}
