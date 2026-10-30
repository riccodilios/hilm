/**
 * Resend webhook handling. The signature (svix / Standard Webhooks, with a 5-minute timestamp
 * window) is verified before anything else; each delivery id is recorded once so replays are
 * ignored. Hard bounces, spam complaints and provider suppressions add the address to
 * private.email_suppressions so Hilm stops emailing it.
 */
import { isValidEmailAddress } from './text.ts'
import type { EmailLogger } from './log.ts'

export const MAX_WEBHOOK_BYTES = 256 * 1024

export type WebhookEvent = {
  type: string
  data?: {
    email_id?: string
    to?: string[]
    bounce?: { type?: string }
  }
}

export type WebhookStore = {
  /** True when this delivery id was not seen before (and is now recorded). */
  recordDelivery(id: string, type: string, emailId: string | null): Promise<boolean>
  suppress(addresses: string[], reason: 'bounced' | 'complained' | 'suppressed'): Promise<void>
}

export type WebhookVerifier = (input: {
  payload: string
  headers: { id: string; timestamp: string; signature: string }
}) => WebhookEvent

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export function suppressionFor(event: WebhookEvent): 'bounced' | 'complained' | 'suppressed' | null {
  if (event.type === 'email.complained') return 'complained'
  if (event.type === 'email.suppressed') return 'suppressed'
  // Only permanent bounces; transient ones are retried by Resend.
  if (event.type === 'email.bounced' && event.data?.bounce?.type === 'Permanent') return 'bounced'
  return null
}

export async function handleResendWebhook(
  request: Request,
  deps: { verify: WebhookVerifier | null; store: () => Promise<WebhookStore>; log: EmailLogger },
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!deps.verify) return json(503, { error: 'not_configured' })

  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_WEBHOOK_BYTES) return json(413, { error: 'too_large' })
  const payload = await request.text()
  if (payload.length > MAX_WEBHOOK_BYTES) return json(413, { error: 'too_large' })

  const id = request.headers.get('svix-id') ?? ''
  const timestamp = request.headers.get('svix-timestamp') ?? ''
  const signature = request.headers.get('svix-signature') ?? ''
  if (!id || !timestamp || !signature || id.length > 100) return json(400, { error: 'missing_signature' })

  let event: WebhookEvent
  try {
    event = deps.verify({ payload, headers: { id, timestamp, signature } })
  } catch {
    deps.log('email.webhook', { outcome: 'ignored', code: 'invalid_signature' })
    return json(401, { error: 'invalid_signature' })
  }
  if (!event || typeof event.type !== 'string') return json(400, { error: 'invalid_event' })

  const store = await deps.store()
  const emailId = typeof event.data?.email_id === 'string' ? event.data.email_id.slice(0, 100) : null
  const fresh = await store.recordDelivery(id, event.type.slice(0, 64), emailId)
  if (!fresh) {
    deps.log('email.webhook', { outcome: 'ignored', code: 'duplicate' })
    return json(200, { ok: true, duplicate: true })
  }

  const reason = suppressionFor(event)
  if (reason) {
    const addresses = (event.data?.to ?? [])
      .map((a) => (typeof a === 'string' ? a.trim().toLowerCase() : ''))
      .filter((a) => isValidEmailAddress(a))
    if (addresses.length) await store.suppress(addresses, reason)
    deps.log('email.webhook', { outcome: 'received', code: reason, items: addresses.length })
  } else {
    deps.log('email.webhook', { outcome: 'received', code: event.type.slice(0, 64) })
  }
  return json(200, { ok: true })
}
