import { supabase } from '@/lib/supabase/client'
import { authDebug } from '@/lib/auth-debug'
import { mapAuthError } from '@/lib/auth'
import type { AuthCallbackParams } from '@/lib/auth-callback-params'

export type { AuthCallbackParams } from '@/lib/auth-callback-params'
export { parseAuthCallbackParams, isSafeAuthNext } from '@/lib/auth-callback-params'

export async function completeAuthCallback(params: AuthCallbackParams) {
  if (params.errorCode || params.errorDescription) {
    throw new Error(params.errorDescription || params.errorCode || 'Authentication failed')
  }

  authDebug('Callback:start', {
    hasCode: Boolean(params.code),
    hasTokenHash: Boolean(params.tokenHash),
    hasToken: Boolean(params.token),
    type: params.type,
    hasEmail: Boolean(params.email),
  })

  if (params.tokenHash && params.type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type,
    })
    if (error) throw error
    authDebug('Callback:verifyOtp', { sessionCreated: Boolean(data.session) })
    return
  }

  if (params.token && params.email && params.type) {
    const { data, error } = await supabase.auth.verifyOtp({
      email: params.email,
      token: params.token,
      type: params.type,
    })
    if (error) throw error
    authDebug('Callback:verifyOtpToken', { sessionCreated: Boolean(data.session) })
    return
  }

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code)
    if (error) throw error
    authDebug('Callback:exchangeCode', { sessionCreated: Boolean(data.session) })
    return
  }

  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (data.session) {
    authDebug('Callback:sessionFromUrl', { sessionCreated: true })
    return
  }

  await new Promise((resolve) => setTimeout(resolve, 400))
  const again = await supabase.auth.getSession()
  if (again.error) throw again.error
  if (again.data.session) {
    authDebug('Callback:sessionRetry', { sessionCreated: true })
    return
  }

  throw new Error('auth.callbackMissingSession')
}

export function mapCallbackError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('auth.')) {
    return error.message
  }
  return mapAuthError(error).key
}
