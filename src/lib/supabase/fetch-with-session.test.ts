import { AuthApiError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('./client', () => ({ supabase: { auth } }))

import { fetchWithSession } from './fetch-with-session'

const session = (token: string) => ({ data: { session: { access_token: token } }, error: null })
const sentTokens = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([, init]) => new Headers((init as RequestInit).headers).get('Authorization'))

describe('fetchWithSession', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    auth.signOut.mockResolvedValue({ error: null })
  })

  it('sends the current token and returns non-401 responses as-is', async () => {
    auth.getSession.mockResolvedValue(session('a'))
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }))
    const response = await fetchWithSession('/api/x', { method: 'POST', body: '{}' })
    expect(response.status).toBe(404)
    expect(sentTokens(fetchMock)).toEqual(['Bearer a'])
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    auth.getSession.mockResolvedValue(session('old'))
    auth.refreshSession.mockResolvedValue(session('new'))
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response('{}'))
    const response = await fetchWithSession('/api/x', { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    expect(sentTokens(fetchMock)).toEqual(['Bearer old', 'Bearer new'])
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('clears the local session when Auth rejects the refresh (revoked session)', async () => {
    auth.getSession.mockResolvedValue(session('old'))
    auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'),
    })
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    const response = await fetchWithSession('/api/x', { method: 'POST', body: '{}' })
    expect(response.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('keeps the session when the refresh fails for a non-auth reason', async () => {
    auth.getSession.mockResolvedValue(session('old'))
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('offline') })
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    await fetchWithSession('/api/x', { method: 'POST', body: '{}' })
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})
