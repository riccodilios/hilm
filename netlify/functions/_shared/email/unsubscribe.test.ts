import { describe, expect, it, vi } from 'vitest'
import { handleUnsubscribe } from './unsubscribe-page.ts'
import { unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from './unsubscribe.ts'

const SECRET = 'x'.repeat(40)
const USER = '11111111-1111-4111-8111-111111111111'

describe('unsubscribe tokens', () => {
  it('verifies only the matching user and secret', () => {
    const token = unsubscribeToken(SECRET, USER)
    expect(verifyUnsubscribeToken(SECRET, USER, token)).toBe(true)
    expect(verifyUnsubscribeToken(SECRET, '22222222-2222-4222-8222-222222222222', token)).toBe(false)
    expect(verifyUnsubscribeToken('y'.repeat(40), USER, token)).toBe(false)
    expect(verifyUnsubscribeToken(SECRET, 'not-a-uuid', token)).toBe(false)
    expect(verifyUnsubscribeToken(SECRET, USER, `${token}x`)).toBe(false)
  })

  it('builds links on the app origin', () => {
    expect(unsubscribeUrl('https://app.hilm.tech', SECRET, USER)).toMatch(
      /^https:\/\/app\.hilm\.tech\/api\/email-unsubscribe\?u=11111111-1111-4111-8111-111111111111&t=[A-Za-z0-9_-]+$/,
    )
  })
})

describe('handleUnsubscribe', () => {
  const url = unsubscribeUrl('https://app.hilm.tech', SECRET, USER)

  it('GET only shows a confirmation form (link scanners do not unsubscribe)', async () => {
    const optOut = vi.fn(async () => undefined)
    const res = await handleUnsubscribe(new Request(url), { secret: SECRET, optOut })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<form method="post"')
    expect(optOut).not.toHaveBeenCalled()
  })

  it('POST (form or one-click) turns marketing email off', async () => {
    const optOut = vi.fn(async () => undefined)
    const res = await handleUnsubscribe(
      new Request(url, { method: 'POST', body: 'List-Unsubscribe=One-Click' }),
      { secret: SECRET, optOut },
    )
    expect(res.status).toBe(200)
    expect(optOut).toHaveBeenCalledWith(USER)
  })

  it('rejects tampered links', async () => {
    const optOut = vi.fn(async () => undefined)
    const bad = url.replace(/t=[^&]+/, 't=forged')
    expect((await handleUnsubscribe(new Request(bad, { method: 'POST' }), { secret: SECRET, optOut })).status).toBe(400)
    expect((await handleUnsubscribe(new Request(url, { method: 'POST' }), { secret: null, optOut })).status).toBe(400)
    expect(optOut).not.toHaveBeenCalled()
  })
})
