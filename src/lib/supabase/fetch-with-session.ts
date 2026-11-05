import { isAuthApiError } from '@supabase/supabase-js'
import { supabase } from './client'

/**
 * fetch() to a Hilm function with the signed-in user's access token. A 401 means the token was
 * rejected (expired, or the session was revoked elsewhere): refresh once and retry. When Auth
 * rejects the refresh too, the session is dead, so clear it locally and let the app return to
 * sign-in instead of failing every server call until the access token expires.
 * The body must be replayable (a string).
 */
export async function fetchWithSession(
  input: string,
  init: Omit<RequestInit, 'body'> & { body?: string } = {},
): Promise<Response> {
  const send = (token: string | undefined) => {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
  }

  const { data } = await supabase.auth.getSession()
  const first = data.session?.access_token
  const response = await send(first)
  if (response.status !== 401 || !first) return response

  const refreshed = await supabase.auth.refreshSession()
  let token = refreshed.data.session?.access_token
  if (!token) {
    // Another tab may have rotated the session while this refresh was discarded.
    const latest = (await supabase.auth.getSession()).data.session?.access_token
    if (latest && latest !== first) token = latest
  }
  if (token) return send(token)

  if (refreshed.error && isAuthApiError(refreshed.error)) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }
  return response
}
