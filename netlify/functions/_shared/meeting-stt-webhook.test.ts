import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ rpc })) }))

const { default: handler } = await import('./meeting-stt-webhook')

const MEETING = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'a'.repeat(64)

function call(options: { token?: string | null; body?: unknown; query?: string; method?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token !== null) headers['X-Hilm-Webhook-Token'] = options.token ?? TOKEN
  return handler(
    new Request(`https://hilm.test/api/meeting-stt-webhook?${options.query ?? `os=personal&meeting=${MEETING}`}`, {
      method: options.method ?? 'POST',
      headers,
      body: options.method === 'GET' ? undefined : JSON.stringify(options.body ?? { id: 'job-1', status: 'completed' }),
    }),
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  rpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('meeting-stt-webhook', () => {
  it('records a verified completion through the token-checking RPC', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const response = await call()
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('meeting_stt_webhook', {
      p_os: 'personal',
      p_meeting_id: MEETING,
      p_job_id: 'job-1',
      p_token: TOKEN,
      p_status: 'completed',
    })
  })

  it('rejects requests without the per-job secret', async () => {
    expect((await call({ token: null })).status).toBe(401)
    expect((await call({ token: 'short' })).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a wrong token, unknown job or finished meeting without detail', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    const response = await call()
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('job-1')
  })

  it('does not trust malformed payloads or parameters', async () => {
    expect((await call({ body: { id: 'job-1', status: 'done', text: 'injected' } })).status).toBe(400)
    expect((await call({ query: 'os=other&meeting=x' })).status).toBe(400)
    expect((await call({ method: 'GET' })).status).toBe(405)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('never logs the webhook secret', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await call()).status).toBe(500)
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain(TOKEN)
  })
})
