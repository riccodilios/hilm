import { createHmac, randomBytes } from 'node:crypto'
import { Resend } from 'resend'
import { describe, expect, it, vi } from 'vitest'
import { handleAuthEmailHook, verifyUrl } from './auth-hook.ts'
import { loadEmailConfig } from './config.ts'
import type { EmailService, SendInput } from './service.ts'

const KEY = randomBytes(24)
const SECRET = `whsec_${KEY.toString('base64')}`
const SUPABASE = 'https://abc.supabase.co'
const USER = '11111111-1111-4111-8111-111111111111'

function signedRequest(body: unknown, opts: { key?: Buffer; timestamp?: number } = {}) {
  const payload = JSON.stringify(body)
  const id = 'msg_hook1'
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', opts.key ?? KEY).update(`${id}.${ts}.${payload}`).digest('base64')
  return new Request('https://app.hilm.tech/api/auth-email-hook', {
    method: 'POST',
    body: payload,
    headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` },
  })
}

const verify = (input: { payload: string; headers: { id: string; timestamp: string; signature: string } }) =>
  new Resend('re_test').webhooks.verify({ ...input, webhookSecret: SECRET })

function setup(enabled = true) {
  const sends: SendInput[] = []
  const service: EmailService = {
    enabled,
    send: vi.fn(async (input: SendInput) => {
      sends.push(input)
      return { ok: true as const, id: `msg_${sends.length}` }
    }),
  }
  const deps = { verify, service, config: loadEmailConfig({ RESEND_API_KEY: 're_test' }), supabaseUrl: SUPABASE, log: () => undefined }
  return { deps, sends }
}

const signup = (over: Record<string, unknown> = {}) => ({
  user: { id: USER, email: 'new@example.com', user_metadata: { locale: 'en' } },
  email_data: {
    token: '482913',
    token_hash: 'pkce_abc123',
    redirect_to: 'https://app.hilm.tech/auth/callback?next=/onboarding',
    email_action_type: 'signup',
    site_url: 'https://app.hilm.tech',
    ...over,
  },
})

describe('handleAuthEmailHook', () => {
  it('sends a Hilm verification email with the code and Supabase verify link', async () => {
    const { deps, sends } = setup()
    const res = await handleAuthEmailHook(signedRequest(signup()), deps)
    expect(res.status).toBe(200)
    expect(sends).toHaveLength(1)
    const mail = sends[0]!
    expect(mail.category).toBe('security')
    expect(mail.to).toBe('new@example.com')
    expect(mail.subject).toBe('482913 is your Hilm verification code')
    expect(mail.text).toContain('Verification code: 482913')
    const link = verifyUrl(SUPABASE, 'pkce_abc123', 'signup', 'https://app.hilm.tech/auth/callback?next=/onboarding')
    expect(mail.text).toContain(link)
    expect(link).toBe(
      'https://abc.supabase.co/auth/v1/verify?token=pkce_abc123&type=signup&redirect_to=https%3A%2F%2Fapp.hilm.tech%2Fauth%2Fcallback%3Fnext%3D%2Fonboarding',
    )
    // The idempotency key never contains the token itself.
    expect(mail.idempotencyKey).not.toContain('pkce_abc123')
    expect(mail.idempotencyKey).not.toContain('482913')
  })

  it('uses Arabic when the user metadata says so and maps recovery', async () => {
    const { deps, sends } = setup()
    const body = signup({ email_action_type: 'recovery' })
    body.user.user_metadata = { locale: 'ar' }
    await handleAuthEmailHook(signedRequest(body), deps)
    expect(sends[0]!.html).toContain('dir="rtl"')
    expect(sends[0]!.subject).toContain('482913')
    expect(sends[0]!.text).toContain('type=recovery')
  })

  it('rejects requests not signed with the hook secret and sends nothing', async () => {
    const { deps, sends } = setup()
    expect((await handleAuthEmailHook(signedRequest(signup(), { key: randomBytes(24) }), deps)).status).toBe(401)
    expect((await handleAuthEmailHook(signedRequest(signup(), { timestamp: Math.floor(Date.now() / 1000) - 3600 }), deps)).status).toBe(401)
    expect(sends).toHaveLength(0)
  })

  it('refuses when email is not configured, and unknown actions', async () => {
    const disabled = setup(false)
    expect((await handleAuthEmailHook(signedRequest(signup()), disabled.deps)).status).toBe(503)
    const { deps } = setup()
    expect((await handleAuthEmailHook(signedRequest(signup({ email_action_type: 'surprise' })), deps)).status).toBe(400)
  })

  it('reports a provider failure so Supabase surfaces the error', async () => {
    const { deps } = setup()
    deps.service.send = vi.fn(async () => ({ ok: false as const, code: 'provider_unavailable' as const, retryable: true }))
    const res = await handleAuthEmailHook(signedRequest(signup()), deps)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: { http_code: 502, message: 'Email could not be sent' } })
  })

  it('sends one message to each address for a secure email change', async () => {
    const { deps, sends } = setup()
    const body = {
      user: { id: USER, email: 'old@example.com', new_email: 'new@example.com' },
      email_data: { token: '111111', token_hash: 'h1', token_new: '222222', token_hash_new: 'h2', email_action_type: 'email_change', redirect_to: 'https://app.hilm.tech/auth/callback' },
    }
    await handleAuthEmailHook(signedRequest(body), deps)
    expect(sends.map((s) => s.to)).toEqual(['old@example.com', 'new@example.com'])
  })
})
