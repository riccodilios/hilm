import { createHmac, randomBytes } from 'node:crypto'
import { Resend } from 'resend'
import { describe, expect, it } from 'vitest'
import { handleResendWebhook, suppressionFor, type WebhookEvent, type WebhookStore } from './webhook.ts'

const SECRET_BYTES = randomBytes(24)
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`

function sign(id: string, timestamp: number, payload: string, key = SECRET_BYTES) {
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64')
  return `v1,${signature}`
}

const verify = (input: { payload: string; headers: { id: string; timestamp: string; signature: string } }) =>
  new Resend('re_test').webhooks.verify({ ...input, webhookSecret: SECRET }) as unknown as WebhookEvent

function memoryStore() {
  const seen = new Set<string>()
  const suppressed: Array<{ addresses: string[]; reason: string }> = []
  const store: WebhookStore = {
    async recordDelivery(id) {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    },
    async suppress(addresses, reason) {
      suppressed.push({ addresses, reason })
    },
  }
  return { store, suppressed }
}

function request(body: unknown, opts: { id?: string; timestamp?: number; signature?: string } = {}) {
  const payload = JSON.stringify(body)
  const id = opts.id ?? 'msg_2abc'
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
  return new Request('https://app.hilm.tech/api/resend-webhook', {
    method: 'POST',
    body: payload,
    headers: {
      'svix-id': id,
      'svix-timestamp': String(timestamp),
      'svix-signature': opts.signature ?? sign(id, timestamp, payload),
    },
  })
}

const bounce = (type: string) => ({
  type: 'email.bounced',
  created_at: new Date().toISOString(),
  data: { email_id: 'em_1', to: ['Person@Example.com'], bounce: { type, subType: 'General', message: 'x' } },
})

describe('handleResendWebhook', () => {
  it('records a permanent bounce as a suppression', async () => {
    const mem = memoryStore()
    const res = await handleResendWebhook(request(bounce('Permanent')), { verify, store: async () => mem.store, log: () => undefined })
    expect(res.status).toBe(200)
    expect(mem.suppressed).toEqual([{ addresses: ['person@example.com'], reason: 'bounced' }])
  })

  it('rejects a bad signature without touching the database', async () => {
    let opened = false
    const res = await handleResendWebhook(request(bounce('Permanent'), { signature: sign('msg_2abc', Math.floor(Date.now() / 1000), '{}') }), {
      verify,
      store: async () => {
        opened = true
        return memoryStore().store
      },
      log: () => undefined,
    })
    expect(res.status).toBe(401)
    expect(opened).toBe(false)
  })

  it('rejects a signature made with another secret', async () => {
    const payload = JSON.stringify(bounce('Permanent'))
    const ts = Math.floor(Date.now() / 1000)
    const res = await handleResendWebhook(
      request(bounce('Permanent'), { timestamp: ts, signature: sign('msg_2abc', ts, payload, randomBytes(24)) }),
      { verify, store: async () => memoryStore().store, log: () => undefined },
    )
    expect(res.status).toBe(401)
  })

  it('rejects replays outside the timestamp window', async () => {
    const old = Math.floor(Date.now() / 1000) - 3600
    const res = await handleResendWebhook(request(bounce('Permanent'), { timestamp: old }), {
      verify,
      store: async () => memoryStore().store,
      log: () => undefined,
    })
    expect(res.status).toBe(401)
  })

  it('ignores a delivery it has already processed', async () => {
    const mem = memoryStore()
    const deps = { verify, store: async () => mem.store, log: () => undefined }
    await handleResendWebhook(request(bounce('Permanent')), deps)
    const again = await handleResendWebhook(request(bounce('Permanent')), deps)
    expect(await again.json()).toEqual({ ok: true, duplicate: true })
    expect(mem.suppressed).toHaveLength(1)
  })

  it('requires the signature headers and configuration', async () => {
    const missing = new Request('https://app.hilm.tech/api/resend-webhook', { method: 'POST', body: '{}' })
    expect((await handleResendWebhook(missing, { verify, store: async () => memoryStore().store, log: () => undefined })).status).toBe(400)
    expect((await handleResendWebhook(request({}), { verify: null, store: async () => memoryStore().store, log: () => undefined })).status).toBe(503)
    const get = new Request('https://app.hilm.tech/api/resend-webhook')
    expect((await handleResendWebhook(get, { verify, store: async () => memoryStore().store, log: () => undefined })).status).toBe(405)
  })
})

describe('suppressionFor', () => {
  it('suppresses hard bounces, complaints and provider suppressions only', () => {
    expect(suppressionFor(bounce('Permanent'))).toBe('bounced')
    expect(suppressionFor(bounce('Transient'))).toBeNull()
    expect(suppressionFor({ type: 'email.complained' })).toBe('complained')
    expect(suppressionFor({ type: 'email.suppressed' })).toBe('suppressed')
    expect(suppressionFor({ type: 'email.delivered' })).toBeNull()
  })
})
