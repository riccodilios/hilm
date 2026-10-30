import { describe, expect, it, vi } from 'vitest'
import { BroadcastError, broadcastRequestSchema, handleBroadcast } from './broadcasts.ts'
import { loadEmailConfig } from './config.ts'
import { fakeDb } from './fake-db.test-helper.ts'
import type { EmailService, SendInput } from './service.ts'
import { allowedCtaUrl } from './templates-engagement.ts'

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@hilm.tech' }
const config = loadEmailConfig({
  RESEND_API_KEY: 're_test',
  EMAIL_UNSUBSCRIBE_SECRET: 's'.repeat(40),
})
const content = { en: { subject: 'New in Hilm', heading: 'Meetings got better', body: 'Line one.\n\nLine two.', ctaLabel: 'See it', ctaUrl: 'https://hilm.tech/meetings' } }

function service() {
  const sends: SendInput[] = []
  const s: EmailService = {
    enabled: true,
    send: vi.fn(async (input: SendInput) => {
      sends.push(input)
      return { ok: true as const, id: 'msg' }
    }),
  }
  return { s, sends }
}

describe('allowedCtaUrl', () => {
  it('allows only https Hilm sites', () => {
    expect(allowedCtaUrl('https://hilm.tech/features')).toBe('https://hilm.tech/features')
    expect(allowedCtaUrl('https://app.hilm.tech/personal')).toBe('https://app.hilm.tech/personal')
    expect(allowedCtaUrl('http://hilm.tech')).toBeNull()
    expect(allowedCtaUrl('https://hilm.tech.evil.com')).toBeNull()
    expect(allowedCtaUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('handleBroadcast', () => {
  const parse = (body: unknown) => broadcastRequestSchema.parse(body)

  it('previews with paragraphs, the button and an unsubscribe link', async () => {
    const { s } = service()
    const res = await handleBroadcast(parse({ action: 'preview', content }), ADMIN, { db: fakeDb([]), service: s, config })
    expect(res.html?.en).toContain('Line two.')
    expect(res.html?.en).toContain('https://hilm.tech/meetings')
    expect(res.html?.en).toContain('Unsubscribe')
  })

  it('rejects buttons to other sites', async () => {
    const bad = { en: { ...content.en, ctaUrl: 'https://evil.example/login' } }
    await expect(
      handleBroadcast(parse({ action: 'preview', content: bad }), ADMIN, { db: fakeDb([]), service: service().s, config }),
    ).rejects.toMatchObject({ code: 'cta_url_not_allowed' })
  })

  it('test sends only to the admin, from noreply with List-Unsubscribe', async () => {
    const { s, sends } = service()
    await handleBroadcast(parse({ action: 'test', content }), ADMIN, { db: fakeDb([]), service: s, config })
    expect(sends).toHaveLength(1)
    expect(sends[0]!.to).toBe('admin@hilm.tech')
    expect(sends[0]!.category).toBe('marketing')
    expect(sends[0]!.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/app\.hilm\.tech\/api\/email-unsubscribe\?u=/)
    expect(sends[0]!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('needs explicit confirmation, respects the cooldown and queues opted-in users', async () => {
    const { s } = service()
    const db = fakeDb([
      [/as recent/, () => ({ rows: [{ recent: false }] })],
      [/insert into private.email_broadcasts/, () => ({ rows: [{ id: 'b1' }] })],
      [/insert into private.email_outbox/, () => ({ rowCount: 7 })],
    ])
    await expect(handleBroadcast(parse({ action: 'send', content }), ADMIN, { db, service: s, config })).rejects.toBeInstanceOf(BroadcastError)
    const res = await handleBroadcast(parse({ action: 'send', content, confirm: 'SEND' }), ADMIN, { db, service: s, config })
    expect(res).toEqual({ broadcastId: 'b1', queued: 7 })
    const queueSql = db.calls.find((c) => /insert into private.email_outbox/.test(c.sql))!.sql
    expect(queueSql).toContain('s.email_marketing_enabled')
    expect(queueSql).toContain('email_confirmed_at is not null')
    expect(queueSql).toContain('email_suppressions')

    const cooling = fakeDb([[/as recent/, () => ({ rows: [{ recent: true }] })]])
    await expect(
      handleBroadcast(parse({ action: 'send', content, confirm: 'SEND' }), ADMIN, { db: cooling, service: s, config }),
    ).rejects.toMatchObject({ status: 429 })
  })
})
