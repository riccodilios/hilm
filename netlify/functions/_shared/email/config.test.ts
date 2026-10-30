import { describe, expect, it } from 'vitest'
import { DEFAULT_FROM, loadEmailConfig } from './config.ts'

describe('loadEmailConfig', () => {
  it('disables sending without RESEND_API_KEY and uses the send.hilm.tech identities', () => {
    const config = loadEmailConfig({})
    expect(config.apiKey).toBeNull()
    expect(config.problems).toEqual([])
    expect(config.from).toEqual({
      notifications: 'Hilm Notifications <notifications@send.hilm.tech>',
      security: 'Hilm Security <security@send.hilm.tech>',
      team: 'Hilm Team <team@send.hilm.tech>',
      marketing: 'Hilm <noreply@send.hilm.tech>',
    })
    expect(config.appBaseUrl).toBe('https://app.hilm.tech')
    expect(config.unsubscribeSecret).toBeNull()
    expect(config.authHookSecret).toBeNull()
    expect(config.adminEmails).toEqual([])
  })

  it('reads the hook secret without its "v1," prefix, admins, and requires a long unsubscribe secret', () => {
    const config = loadEmailConfig({
      SUPABASE_AUTH_HOOK_SECRET: 'v1,whsec_abc',
      HILM_ADMIN_EMAILS: ' Owner@Hilm.tech ,',
      EMAIL_UNSUBSCRIBE_SECRET: 'short',
    })
    expect(config.authHookSecret).toBe('whsec_abc')
    expect(config.adminEmails).toEqual(['owner@hilm.tech'])
    expect(config.unsubscribeSecret).toBeNull()
    expect(config.problems).toContain('EMAIL_UNSUBSCRIBE_SECRET must be at least 32 characters')
  })

  it('reads the key, sender overrides and base URL', () => {
    const config = loadEmailConfig({
      RESEND_API_KEY: ' re_test_123 ',
      RESEND_FROM_TEAM: 'Hilm Crew <crew@send.hilm.tech>',
      APP_BASE_URL: 'https://app.hilm.tech/',
      RESEND_WEBHOOK_SECRET: 'whsec_abc',
    })
    expect(config.apiKey).toBe('re_test_123')
    expect(config.from.team).toBe('Hilm Crew <crew@send.hilm.tech>')
    expect(config.from.notifications).toBe(DEFAULT_FROM.notifications)
    expect(config.appBaseUrl).toBe('https://app.hilm.tech')
    expect(config.webhookSecret).toBe('whsec_abc')
  })

  it('falls back to APP_URL', () => {
    expect(loadEmailConfig({ APP_URL: 'https://preview.example.com' }).appBaseUrl).toBe('https://preview.example.com')
  })

  it('reports malformed senders and insecure base URLs without echoing secrets', () => {
    const config = loadEmailConfig({
      RESEND_API_KEY: 're_secret_value',
      RESEND_FROM_SECURITY: 'security@send.hilm.tech\r\nBcc: victim@example.com',
      APP_BASE_URL: 'http://app.hilm.tech',
    })
    expect(config.problems).toHaveLength(2)
    expect(config.from.security).toBe(DEFAULT_FROM.security)
    expect(config.problems.join(' ')).not.toContain('re_secret_value')
  })

  it('allows http only for localhost', () => {
    expect(loadEmailConfig({ APP_BASE_URL: 'http://localhost:5173' }).problems).toEqual([])
  })
})
