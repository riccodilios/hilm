import { describe, expect, it } from 'vitest'
import { authorizeCronRequest } from './cron-auth'

const url = 'https://app.hilm.tech/.netlify/functions/send-task-reminders'

describe('authorizeCronRequest', () => {
  it('fails closed without a configured secret', () => {
    expect(authorizeCronRequest(new Request(url, { headers: { 'x-cron-secret': 'x' } }), '')).toMatchObject({ ok: false, status: 500 })
  })

  it('accepts the secret in a header only', () => {
    expect(authorizeCronRequest(new Request(url, { headers: { 'x-cron-secret': 's3cret' } }), 's3cret')).toEqual({ ok: true })
    expect(authorizeCronRequest(new Request(url, { headers: { Authorization: 'Bearer s3cret' } }), 's3cret')).toEqual({ ok: true })
    expect(authorizeCronRequest(new Request(`${url}?cron_secret=s3cret`), 's3cret')).toMatchObject({ ok: false, status: 401 })
    expect(authorizeCronRequest(new Request(url, { headers: { 'x-cron-secret': 's3cret-but-longer' } }), 's3cret')).toMatchObject({ ok: false })
  })

  it('rejects a browser-originated schedule header', () => {
    const forged = new Request(url, { headers: { 'x-netlify-event': 'schedule', origin: 'https://evil.example' } })
    expect(authorizeCronRequest(forged, 's3cret')).toMatchObject({ ok: false, status: 401 })
  })
})
