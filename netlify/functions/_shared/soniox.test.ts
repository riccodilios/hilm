import { describe, expect, it, vi } from 'vitest'
import { SONIOX_ASYNC_MODEL, createSonioxClient, sonioxApiKey, withSonioxRetry } from './soniox'

const KEY = 'test-soniox-key-not-real'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockFetch(...responses: Array<Response | Error>) {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected fetch')
    if (next instanceof Error) throw next
    return next
  })
}

describe('soniox client', () => {
  it('reads the key only from SONIOX_API_KEY', () => {
    vi.stubEnv('SONIOX_API_KEY', '  abc  ')
    expect(sonioxApiKey()).toBe('abc')
    vi.stubEnv('SONIOX_API_KEY', '')
    expect(sonioxApiKey()).toBeNull()
    vi.unstubAllEnvs()
  })

  it('creates a diarized, language-identified async transcription with the webhook secret', async () => {
    const fetchImpl = mockFetch(jsonResponse({ id: 'job-1', status: 'queued' }))
    const client = createSonioxClient({ apiKey: KEY, fetchImpl })
    const result = await client.createTranscription({
      fileId: 'file-1',
      languageHints: ['ar', 'en'],
      context: { terms: ['Hilm'] },
      webhookUrl: 'https://example.test/api/meeting-stt-webhook?os=personal&meeting=x',
      webhookAuthHeaderName: 'X-Hilm-Webhook-Token',
      webhookAuthHeaderValue: 'secret-token',
      clientReferenceId: 'hilm:personal:x',
    })
    expect(result).toEqual({ ok: true, data: { id: 'job-1', status: 'queued' } })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.soniox.com/v1/transcriptions')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      model: SONIOX_ASYNC_MODEL,
      file_id: 'file-1',
      enable_speaker_diarization: true,
      enable_language_identification: true,
      language_hints: ['ar', 'en'],
      context: { terms: ['Hilm'] },
      webhook_auth_header_name: 'X-Hilm-Webhook-Token',
      webhook_auth_header_value: 'secret-token',
      client_reference_id: 'hilm:personal:x',
    })
    expect(body).not.toHaveProperty('translation')
  })

  it('classifies HTTP failures and never echoes the API key', async () => {
    const client = createSonioxClient({
      apiKey: KEY,
      fetchImpl: mockFetch(
        jsonResponse({ error_type: 'unauthenticated', message: 'bad key' }, 401),
        jsonResponse({ message: 'no balance' }, 402),
        jsonResponse({}, 429),
        new Response('oops', { status: 503 }),
      ),
    })
    const auth = await client.getTranscription('a')
    const balance = await client.getTranscription('b')
    const limited = await client.getTranscription('c')
    const server = await client.getTranscription('d')
    expect(auth).toMatchObject({ ok: false, code: 'unauthenticated', retryable: false, status: 401 })
    expect(balance).toMatchObject({ ok: false, code: 'balance_exhausted', retryable: false })
    expect(limited).toMatchObject({ ok: false, code: 'rate_limited', retryable: true })
    expect(server).toMatchObject({ ok: false, code: 'provider_error', retryable: true })
    for (const result of [auth, balance, limited, server]) expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('rejects structurally invalid responses', async () => {
    const client = createSonioxClient({
      apiKey: KEY,
      fetchImpl: mockFetch(jsonResponse({ text: 'hi', tokens: [{ text: 'hi' }] })),
    })
    expect(await client.getTranscript('job')).toMatchObject({ ok: false, code: 'invalid_response', retryable: false })
  })

  it('maps network errors to a retryable failure', async () => {
    const client = createSonioxClient({ apiKey: KEY, fetchImpl: mockFetch(new TypeError('fetch failed')) })
    expect(await client.getTranscription('job')).toMatchObject({ ok: false, code: 'network', retryable: true, status: null })
  })
})

describe('withSonioxRetry', () => {
  const sleep = vi.fn(async () => undefined)

  it('retries transient failures a bounded number of times', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'rate_limited', retryable: true, status: 429, message: '' })
      .mockResolvedValueOnce({ ok: true, data: 1 })
    expect(await withSonioxRetry(run, { sleep })).toEqual({ ok: true, data: 1 })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('never retries permanent failures', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, code: 'balance_exhausted', retryable: false, status: 402, message: '' })
    await withSonioxRetry(run, { sleep })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('honours retryIf so an ambiguous create is not repeated', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, code: 'network', retryable: true, status: null, message: '' })
    await withSonioxRetry(run, { sleep, retryIf: (failure) => failure.status !== null })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
