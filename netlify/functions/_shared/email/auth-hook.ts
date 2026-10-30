/**
 * Supabase Auth "Send Email" hook. Supabase still creates and verifies every token; Hilm only
 * renders and delivers the email (Hilm design, EN/AR, 6-digit code + button). The request is
 * signed (Standard Webhooks) with the hook secret; nothing is sent unless the signature verifies.
 * Tokens are never logged.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { EmailConfig } from './config.ts'
import type { EmailLogger } from './log.ts'
import type { EmailService } from './service.ts'
import { authEmail, type AuthEmailAction } from './templates-engagement.ts'

const ACTIONS = ['signup', 'recovery', 'magiclink', 'email', 'invite', 'email_change', 'reauthentication'] as const

const payloadSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().max(254).optional().nullable(),
    new_email: z.string().max(254).optional().nullable(),
    user_metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  }),
  email_data: z.object({
    token: z.string().max(20).optional().nullable(),
    token_hash: z.string().max(200).optional().nullable(),
    redirect_to: z.string().max(2000).optional().nullable(),
    email_action_type: z.string().max(40),
    site_url: z.string().max(500).optional().nullable(),
    token_new: z.string().max(20).optional().nullable(),
    token_hash_new: z.string().max(200).optional().nullable(),
  }),
})

export type AuthHookVerifier = (input: {
  payload: string
  headers: { id: string; timestamp: string; signature: string }
}) => unknown

const hookError = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Supabase's own verify endpoint, so token checks and redirects behave exactly as before. */
export function verifyUrl(supabaseUrl: string, tokenHash: string, action: AuthEmailAction, redirectTo: string) {
  const type = action === 'email' ? 'magiclink' : action
  const params = new URLSearchParams({ token: tokenHash, type, redirect_to: redirectTo })
  return `${supabaseUrl.replace(/\/$/, '')}/auth/v1/verify?${params.toString()}`
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32)

export async function handleAuthEmailHook(
  request: Request,
  deps: {
    verify: AuthHookVerifier | null
    service: EmailService
    config: EmailConfig
    supabaseUrl: string
    log: EmailLogger
  },
): Promise<Response> {
  if (request.method !== 'POST') return hookError(405, 'Method not allowed')
  if (!deps.verify || !deps.service.enabled || !deps.supabaseUrl) {
    deps.log('email.auth_hook', { outcome: 'disabled', code: 'not_configured' })
    return hookError(503, 'Email delivery is not configured')
  }

  const payload = await request.text()
  if (payload.length > 64 * 1024) return hookError(413, 'Payload too large')
  const id = request.headers.get('webhook-id') ?? ''
  const timestamp = request.headers.get('webhook-timestamp') ?? ''
  const signature = request.headers.get('webhook-signature') ?? ''
  if (!id || !timestamp || !signature) return hookError(401, 'Missing signature')

  let body: unknown
  try {
    body = deps.verify({ payload, headers: { id, timestamp, signature } })
  } catch {
    deps.log('email.auth_hook', { outcome: 'ignored', code: 'invalid_signature' })
    return hookError(401, 'Invalid signature')
  }

  const parsed = payloadSchema.safeParse(body)
  const actionName = parsed.success ? parsed.data.email_data.email_action_type : ''
  if (!parsed.success || !(ACTIONS as readonly string[]).includes(actionName)) {
    deps.log('email.auth_hook', { outcome: 'failed', code: 'invalid_payload' })
    return hookError(400, 'Unsupported email request')
  }
  const { user, email_data: data } = parsed.data
  const action = actionName as AuthEmailAction
  const locale = String(user.user_metadata?.locale ?? '').startsWith('ar') ? 'ar' : 'en'
  const redirectTo = data.redirect_to || data.site_url || deps.config.appBaseUrl

  // Secure email change sends one message to each address; everything else goes to user.email.
  const messages: Array<{ to: string; code: string | null; tokenHash: string | null }> = []
  if (action === 'email_change') {
    if (user.email && data.token_hash) messages.push({ to: user.email, code: data.token ?? null, tokenHash: data.token_hash })
    if (user.new_email && data.token_hash_new) {
      messages.push({ to: user.new_email, code: data.token_new ?? null, tokenHash: data.token_hash_new })
    } else if (user.new_email && !user.email && data.token_hash) {
      messages.push({ to: user.new_email, code: data.token ?? null, tokenHash: data.token_hash })
    }
  } else if (user.email) {
    messages.push({ to: user.email, code: data.token ?? null, tokenHash: data.token_hash ?? null })
  }
  if (!messages.length) return hookError(400, 'No recipient')

  for (const message of messages) {
    const email = authEmail({
      locale,
      action,
      code: message.code,
      confirmUrl:
        message.tokenHash && action !== 'reauthentication'
          ? verifyUrl(deps.supabaseUrl, message.tokenHash, action, redirectTo)
          : null,
    })
    const result = await deps.service.send({
      category: email.category,
      template: email.template,
      to: message.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `hilm/auth/${action}/${hash(`${message.tokenHash ?? message.code ?? ''}:${message.to}`)}`,
    })
    if (!result.ok) return hookError(result.code === 'invalid_recipient' ? 400 : 502, 'Email could not be sent')
  }
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
}
