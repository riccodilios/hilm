import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../meeting-share'

const { anonRpc, userRpc, createClient } = vi.hoisted(() => {
  const anonRpc = vi.fn()
  const userRpc = vi.fn()
  const createClient = vi.fn((_url: string, _key: string, options?: { global?: { headers?: Record<string, string> } }) =>
    options?.global?.headers?.Authorization ? { rpc: userRpc } : { rpc: anonRpc },
  )
  return { anonRpc, userRpc, createClient }
})
vi.mock('@supabase/supabase-js', () => ({ createClient }))

const TOKEN = 'Ab3_-'.repeat(8) + 'xyz'
const ID = '11111111-1111-4111-8111-111111111111'
const PAYLOAD = { meeting: { title: 'Sync' }, speakers: [], transcript: [], decisions: [], action_items: [] }

function call(body: unknown, options: { jwt?: string; method?: string } = {}) {
  return handler(
    new Request('https://hilm.test/api/meeting-share', {
      method: options.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.jwt ? { Authorization: `Bearer ${options.jwt}` } : {}) },
      body: options.method === 'GET' ? undefined : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  anonRpc.mockReset()
  userRpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('meeting-share', () => {
  it('returns the shared meeting to an anonymous viewer, uncached and unindexed', async () => {
    expect(TOKEN).toHaveLength(43)
    anonRpc.mockResolvedValue({ data: PAYLOAD, error: null })
    const response = await call({ token: TOKEN })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, meeting: PAYLOAD, appHref: null })
    expect(anonRpc).toHaveBeenCalledWith('get_shared_meeting', { p_token: TOKEN })
    expect(userRpc).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(response.headers.get('Vary')).toBe('Authorization')
  })

  it('gives a signed-in member the in-app address of a meeting they can open', async () => {
    anonRpc.mockResolvedValue({ data: PAYLOAD, error: null })
    userRpc.mockResolvedValue({ data: { os: 'workspace', meeting_id: ID, project_id: ID, workspace_id: ID }, error: null })
    const response = await call({ token: TOKEN }, { jwt: 'user-jwt' })
    expect((await response.json()).appHref).toBe(`/workspace/${ID}/projects/${ID}/meetings/${ID}`)
    expect(userRpc).toHaveBeenCalledWith('shared_meeting_app_link', { p_token: TOKEN })
  })

  it('a signed-in user without access sees the shared view only (no private access)', async () => {
    anonRpc.mockResolvedValue({ data: PAYLOAD, error: null })
    userRpc.mockResolvedValue({ data: null, error: null })
    const body = await (await call({ token: TOKEN }, { jwt: 'other-user' })).json()
    expect(body).toEqual({ ok: true, meeting: PAYLOAD, appHref: null })
  })

  it('treats malformed, unknown and revoked tokens the same and never queries for malformed ones', async () => {
    anonRpc.mockResolvedValue({ data: null, error: null })
    for (const token of ['short', `${TOKEN.slice(0, 42)}/`, `${TOKEN}x`, '../../meetings']) {
      expect((await call({ token })).status).toBe(404)
    }
    expect(anonRpc).not.toHaveBeenCalled()
    expect((await call({ token: TOKEN })).status).toBe(404)
    expect((await call({ nope: true })).status).toBe(404)
    expect((await call({}, { method: 'GET' })).status).toBe(405)
  })

  it('never logs the token', async () => {
    anonRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await call({ token: TOKEN })).status).toBe(500)
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain(TOKEN)
  })
})
