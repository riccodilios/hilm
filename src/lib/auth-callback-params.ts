import type { EmailOtpType } from '@supabase/supabase-js'

export type AuthCallbackParams = {
  code: string | null
  tokenHash: string | null
  token: string | null
  type: EmailOtpType | null
  email: string | null
  errorCode: string | null
  errorDescription: string | null
}

const OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

export function parseAuthCallbackParams(searchParams: URLSearchParams): AuthCallbackParams {
  const rawType = searchParams.get('type')
  const type = rawType && OTP_TYPES.has(rawType as EmailOtpType) ? (rawType as EmailOtpType) : null
  return {
    code: searchParams.get('code'),
    tokenHash: searchParams.get('token_hash'),
    token: searchParams.get('token'),
    type,
    email: searchParams.get('email'),
    errorCode: searchParams.get('error'),
    errorDescription: searchParams.get('error_description'),
  }
}

/** Prevent open redirects via ?next= — only same-app absolute paths. */
export function isSafeAuthNext(next: string) {
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('://') || next.includes('\\')) {
    return false
  }
  return (
    next === '/onboarding' ||
    next === '/personal' ||
    next.startsWith('/personal/') ||
    next.startsWith('/workspace') ||
    next.startsWith('/auth/')
  )
}
