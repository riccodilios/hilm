import { describe, expect, it, vi } from 'vitest'
import { loadEmailConfig } from './config.ts'
import type { EmailLogFields } from './log.ts'
import { createEmailService, mapProviderError, type EmailTransport, type SendInput } from './service.ts'

const input: SendInput = {
  category: 'notifications',
  template: 'task-reminder',
  to: 'person@example.com',
  subject: 'Reminder: Ship',
  html: '<p>hi</p>',
  text: 'hi',
  idempotencyKey: 'hilm/task_reminder/abc',
}

function setup(result: Awaited<ReturnType<EmailTransport['send']>> | Error, env: Record<string, string> = {}) {
  const send = vi.fn<EmailTransport['send']>(async () => {
    if (result instanceof Error) throw result
    return result
  })
  const logs: Array<{ event: string; fields?: EmailLogFields }> = []
  const service = createEmailService(loadEmailConfig({ RESEND_API_KEY: 're_test', ...env }), {
    transport: { send },
    log: (event, fields) => logs.push({ event, fields }),
  })
  return { service, send, logs }
}

describe('createEmailService', () => {
  it('is disabled without an API key and never calls the provider', async () => {
    const send = vi.fn()
    const service = createEmailService(loadEmailConfig({}), { transport: { send }, log: () => undefined })
    expect(service.enabled).toBe(false)
    expect(await service.send(input)).toEqual({ ok: false, code: 'not_configured', retryable: false })
    expect(send).not.toHaveBeenCalled()
  })

  it('is disabled when the configuration has problems', async () => {
    const { service, send } = setup({ data: { id: 'x' }, error: null }, { RESEND_FROM_TEAM: 'broken' })
    expect(service.enabled).toBe(false)
    await service.send(input)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends from the category identity with the idempotency key and reply-to', async () => {
    const { service, send } = setup({ data: { id: 'msg_1' }, error: null })
    expect(await service.send(input)).toEqual({ ok: true, id: 'msg_1' })
    expect(send).toHaveBeenCalledTimes(1)
    const [payload, options] = send.mock.calls[0]!
    expect(payload.from).toBe('Hilm Notifications <notifications@hilm.tech>')
    expect(payload.to).toEqual(['person@example.com'])
    expect(payload.replyTo).toBe('info@hilm.tech')
    expect(payload.text).toBe('hi')
    expect(options).toEqual({ idempotencyKey: 'hilm/task_reminder/abc' })

    await service.send({ ...input, category: 'security' })
    expect(send.mock.calls[1]![0].from).toBe('Hilm Security <security@hilm.tech>')
  })

  it('rejects invalid recipients before calling the provider', async () => {
    const { service, send } = setup({ data: { id: 'x' }, error: null })
    const result = await service.send({ ...input, to: 'a@example.com\r\nBcc: b@example.com' })
    expect(result).toMatchObject({ ok: false, code: 'invalid_recipient', retryable: false })
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects missing bodies and malformed idempotency keys', async () => {
    const { service, send } = setup({ data: { id: 'x' }, error: null })
    expect(await service.send({ ...input, text: '' })).toMatchObject({ code: 'invalid_input' })
    expect(await service.send({ ...input, idempotencyKey: 'has spaces' })).toMatchObject({ code: 'invalid_input' })
    expect(send).not.toHaveBeenCalled()
  })

  it('maps provider errors to retryable / permanent codes', async () => {
    const rate = setup({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'slow down' } })
    expect(await rate.service.send(input)).toMatchObject({ ok: false, code: 'rate_limited', retryable: true })

    const bad = setup({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'person@example.com bad' } })
    expect(await bad.service.send(input)).toMatchObject({ ok: false, code: 'rejected', retryable: false })

    const network = setup(new Error('ECONNRESET'))
    expect(await network.service.send(input)).toMatchObject({ ok: false, code: 'provider_unavailable', retryable: true })
  })

  it('never logs addresses, subjects or provider messages', async () => {
    const { service, logs } = setup({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'person@example.com rejected' } })
    await service.send(input)
    const serialized = JSON.stringify(logs)
    expect(serialized).not.toContain('person@example.com')
    expect(serialized).not.toContain('Reminder: Ship')
    expect(logs[0]?.fields).toMatchObject({ outcome: 'failed', code: 'rejected', template: 'task-reminder' })
  })
})

describe('mapProviderError', () => {
  it.each([
    ['daily_quota_exceeded', 'quota_exceeded', true],
    ['monthly_quota_exceeded', 'quota_exceeded', false],
    ['internal_server_error', 'provider_unavailable', true],
    ['invalid_idempotent_request', 'idempotency_conflict', false],
    ['invalid_api_key', 'auth_failed', false],
  ])('%s → %s', (name, code, retryable) => {
    expect(mapProviderError({ name })).toEqual({ code, retryable })
  })

  it('treats unknown 5xx as retryable', () => {
    expect(mapProviderError({ name: 'something_new', statusCode: 503 })).toEqual({ code: 'provider_unavailable', retryable: true })
  })
})
