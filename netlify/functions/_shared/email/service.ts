/**
 * Central email service. All mail leaves Hilm through send(): it validates the recipient and
 * headers, picks the sender for the category, sends through the official Resend SDK with an
 * idempotency key, and maps provider errors to short codes without leaking details.
 */
import { Resend } from 'resend'
import type { EmailCategory, EmailConfig } from './config.ts'
import { logEmail, type EmailLogger } from './log.ts'
import { isValidEmailAddress, singleLine } from './text.ts'

export type SendInput = {
  category: EmailCategory
  /** For logs only. */
  template: string
  to: string
  subject: string
  html: string
  text: string
  /** Stable per logical email so retries never deliver twice (Resend keeps keys 24h). */
  idempotencyKey: string
  /** Extra headers (e.g. List-Unsubscribe). Names/values are validated. */
  headers?: Record<string, string>
}

export type SendErrorCode =
  | 'not_configured'
  | 'invalid_recipient'
  | 'invalid_input'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'provider_unavailable'
  | 'auth_failed'
  | 'rejected'
  | 'idempotency_conflict'

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; code: SendErrorCode; retryable: boolean; status?: number | null }

/** The slice of the Resend SDK the service uses (swapped for a mock in tests). */
export type EmailTransport = {
  send(
    payload: {
      from: string
      to: string[]
      subject: string
      html: string
      text: string
      replyTo?: string
      headers?: Record<string, string>
      tags?: Array<{ name: string; value: string }>
    },
    options: { idempotencyKey: string },
  ): Promise<{
    data: { id: string } | null
    error: { name: string; statusCode?: number | null; message?: string } | null
  }>
}

export const REPLY_TO = 'info@hilm.tech'
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9/_.:-]{1,256}$/
const TAG_VALUE_RE = /[^A-Za-z0-9_-]/g
const HEADER_NAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,63}$/
// oxlint-disable-next-line no-control-regex
const HEADER_VALUE_UNSAFE = /[\u0000-\u001f\u007f]/

function safeHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return undefined
  const entries = Object.entries(headers)
  if (entries.some(([k, v]) => !HEADER_NAME_RE.test(k) || HEADER_VALUE_UNSAFE.test(v) || v.length > 900)) return null
  return Object.fromEntries(entries)
}

export function mapProviderError(error: { name: string; statusCode?: number | null }): {
  code: SendErrorCode
  retryable: boolean
} {
  switch (error.name) {
    case 'rate_limit_exceeded':
      return { code: 'rate_limited', retryable: true }
    case 'daily_quota_exceeded':
      return { code: 'quota_exceeded', retryable: true }
    case 'monthly_quota_exceeded':
      return { code: 'quota_exceeded', retryable: false }
    case 'concurrent_idempotent_requests':
    case 'application_error':
    case 'internal_server_error':
      return { code: 'provider_unavailable', retryable: true }
    case 'invalid_idempotent_request':
    case 'invalid_idempotency_key':
      return { code: 'idempotency_conflict', retryable: false }
    case 'missing_api_key':
    case 'invalid_api_key':
    case 'restricted_api_key':
    case 'invalid_access':
    case 'security_error':
      return { code: 'auth_failed', retryable: false }
    default:
      if ((error.statusCode ?? 0) >= 500) return { code: 'provider_unavailable', retryable: true }
      return { code: 'rejected', retryable: false }
  }
}

export type EmailService = {
  readonly enabled: boolean
  send(input: SendInput): Promise<SendResult>
}

export function createEmailService(
  config: EmailConfig,
  deps: { transport?: EmailTransport; log?: EmailLogger } = {},
): EmailService {
  const log = deps.log ?? logEmail
  const enabled = Boolean(config.apiKey) && config.problems.length === 0
  let transport = deps.transport ?? null
  if (!transport && enabled) transport = new Resend(config.apiKey!).emails as unknown as EmailTransport

  return {
    enabled,
    async send(input) {
      const base = { template: input.template, category: input.category }
      if (!enabled || !transport) {
        log('email.send', { ...base, outcome: 'disabled', code: 'not_configured' })
        return { ok: false, code: 'not_configured', retryable: false }
      }
      if (!isValidEmailAddress(input.to)) {
        log('email.send', { ...base, outcome: 'skipped', code: 'invalid_recipient' })
        return { ok: false, code: 'invalid_recipient', retryable: false }
      }
      const subject = singleLine(input.subject, 200)
      const headers = safeHeaders(input.headers)
      if (!subject || !input.html || !input.text || headers === null || !IDEMPOTENCY_KEY_RE.test(input.idempotencyKey)) {
        log('email.send', { ...base, outcome: 'failed', code: 'invalid_input' })
        return { ok: false, code: 'invalid_input', retryable: false }
      }

      const started = Date.now()
      try {
        const { data, error } = await transport.send(
          {
            from: config.from[input.category],
            to: [input.to],
            subject,
            html: input.html,
            text: input.text,
            replyTo: REPLY_TO,
            ...(headers ? { headers } : {}),
            tags: [
              { name: 'category', value: input.category },
              { name: 'template', value: input.template.replace(TAG_VALUE_RE, '_').slice(0, 256) },
            ],
          },
          { idempotencyKey: input.idempotencyKey },
        )
        if (error || !data?.id) {
          const mapped = error ? mapProviderError(error) : { code: 'rejected' as const, retryable: false }
          log('email.send', {
            ...base,
            outcome: mapped.retryable ? 'retry' : 'failed',
            code: mapped.code,
            status: error?.statusCode ?? null,
            durationMs: Date.now() - started,
          })
          return { ok: false, ...mapped, status: error?.statusCode ?? null }
        }
        log('email.send', { ...base, outcome: 'sent', messageId: data.id, durationMs: Date.now() - started })
        return { ok: true, id: data.id }
      } catch {
        // Network failure or SDK bug: the request may or may not have reached Resend. Retrying with
        // the same idempotency key is safe.
        log('email.send', { ...base, outcome: 'retry', code: 'provider_unavailable', durationMs: Date.now() - started })
        return { ok: false, code: 'provider_unavailable', retryable: true }
      }
    },
  }
}
