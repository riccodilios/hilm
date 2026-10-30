/**
 * Email configuration, read from server-side environment variables only (never VITE_*).
 * Sender identities live on the dedicated sending subdomain send.hilm.tech; they are sending
 * identities, not mailboxes.
 */

export type EmailCategory = 'notifications' | 'security' | 'team'

export type EmailConfig = {
  /** Null when RESEND_API_KEY is missing: sending is disabled and callers skip quietly. */
  apiKey: string | null
  from: Record<EmailCategory, string>
  /** Origin used for every link in an email, e.g. https://app.hilm.tech (no trailing slash). */
  appBaseUrl: string
  webhookSecret: string | null
  /** Problems that disable sending (bad sender format, bad base URL). Never contains secrets. */
  problems: string[]
}

export const DEFAULT_FROM: Record<EmailCategory, string> = {
  notifications: 'Hilm Notifications <notifications@send.hilm.tech>',
  security: 'Hilm Security <security@send.hilm.tech>',
  team: 'Hilm Team <team@send.hilm.tech>',
}

export const DEFAULT_APP_BASE_URL = 'https://app.hilm.tech'

const FROM_RE = /^[A-Za-z0-9 .'&-]{1,64} <[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}>$/

export function isValidSender(value: string) {
  return FROM_RE.test(value)
}

function normalizeBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null
    if (url.username || url.password || url.search || url.hash) return null
    return url.origin + url.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}

type Env = Record<string, string | undefined>

export function loadEmailConfig(env: Env = process.env): EmailConfig {
  const problems: string[] = []
  const apiKey = env.RESEND_API_KEY?.trim() || null

  const from = { ...DEFAULT_FROM }
  const overrides: Record<EmailCategory, string | undefined> = {
    notifications: env.RESEND_FROM_NOTIFICATIONS,
    security: env.RESEND_FROM_SECURITY,
    team: env.RESEND_FROM_TEAM,
  }
  for (const category of Object.keys(overrides) as EmailCategory[]) {
    const value = overrides[category]?.trim()
    if (!value) continue
    if (isValidSender(value)) from[category] = value
    else problems.push(`RESEND_FROM_${category.toUpperCase()} is not in "Name <address>" form`)
  }

  const rawBase = env.APP_BASE_URL || env.APP_URL || DEFAULT_APP_BASE_URL
  const appBaseUrl = normalizeBaseUrl(rawBase)
  if (!appBaseUrl) problems.push('APP_BASE_URL must be an https URL without query or credentials')

  return {
    apiKey,
    from,
    appBaseUrl: appBaseUrl ?? DEFAULT_APP_BASE_URL,
    webhookSecret: env.RESEND_WEBHOOK_SECRET?.trim() || null,
    problems,
  }
}
