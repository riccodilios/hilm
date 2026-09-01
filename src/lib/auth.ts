/** Map Supabase / network auth failures into stable i18n keys + optional wait seconds. */

export type AuthErrorInfo = {
  key: string
  waitSeconds?: number
  retryable?: boolean
}

function messageOf(error: unknown) {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message ?? '')
  }
  return String(error)
}

function statusOf(error: unknown) {
  if (typeof error === 'object' && error && 'status' in error) {
    return Number((error as { status?: number }).status) || undefined
  }
  return undefined
}

export function isTransientAuthError(error: unknown) {
  const msg = messageOf(error).toLowerCase()
  const status = statusOf(error)
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('temporarily unavailable') ||
    status === 502 ||
    status === 503 ||
    status === 504
  )
}

export function isRateLimitAuthError(error: unknown) {
  const msg = messageOf(error).toLowerCase()
  const status = statusOf(error)
  return (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many') ||
    msg.includes('over_email_send_rate_limit') ||
    msg.includes('email rate limit')
  )
}

export function mapAuthError(error: unknown): AuthErrorInfo {
  const msg = messageOf(error).toLowerCase()
  const status = statusOf(error)

  if (isRateLimitAuthError(error)) {
    return { key: 'auth.errors.rateLimit', waitSeconds: 60, retryable: false }
  }

  if (isTransientAuthError(error)) {
    return { key: 'auth.errors.network', retryable: true }
  }

  if (msg.includes('user already registered') || msg.includes('already been registered')) {
    return { key: 'auth.errors.alreadyRegistered' }
  }

  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return { key: 'auth.errors.invalidCredentials' }
  }

  if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
    return { key: 'auth.errors.emailNotConfirmed' }
  }

  if (
    msg.includes('expired') ||
    msg.includes('invalid or has expired') ||
    msg.includes('otp_expired') ||
    msg.includes('token has expired') ||
    msg.includes('link is invalid')
  ) {
    return { key: 'auth.errors.expiredToken' }
  }

  if (msg.includes('invalid otp') || msg.includes('invalid token') || msg.includes('invalid link')) {
    return { key: 'auth.errors.invalidToken' }
  }

  if (msg.includes('already confirmed') || msg.includes('already verified')) {
    return { key: 'auth.errors.alreadyVerified' }
  }

  if (msg.includes('password') && (msg.includes('weak') || msg.includes('least') || msg.includes('short'))) {
    return { key: 'auth.errors.weakPassword' }
  }

  if (msg.includes('invalid email') || msg.includes('unable to validate email')) {
    return { key: 'auth.errors.invalidEmail' }
  }

  if (msg.includes('signup is disabled') || msg.includes('signups not allowed')) {
    return { key: 'auth.errors.signupDisabled' }
  }

  if (status === 400 || status === 422) {
    return { key: 'auth.errors.invalidRequest' }
  }

  return { key: 'auth.errors.generic', retryable: isTransientAuthError(error) }
}

export async function withAuthRetry<T extends { data: unknown; error: unknown }>(
  run: () => PromiseLike<T>,
  opts?: { attempts?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 3
  let last: T | undefined

  for (let i = 0; i < attempts; i += 1) {
    try {
      const result = await run()
      last = result
      if (!result.error) return result
      if (!isTransientAuthError(result.error) || isRateLimitAuthError(result.error)) {
        return result
      }
    } catch (error) {
      last = { data: null, error } as T
      if (!isTransientAuthError(error) || isRateLimitAuthError(error) || i === attempts - 1) {
        return last
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 450 * (i + 1)))
  }

  return last ?? ({ data: null, error: new Error('Authentication failed') } as T)
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function validateSignupInput(input: {
  email: string
  password: string
  confirmPassword?: string
}) {
  const email = normalizeEmail(input.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, key: 'auth.errors.invalidEmail' }
  }
  if (input.password.length < 8) {
    return { ok: false as const, key: 'auth.errors.weakPassword' }
  }
  if (input.confirmPassword != null && input.password !== input.confirmPassword) {
    return { ok: false as const, key: 'auth.errors.passwordMismatch' }
  }
  return { ok: true as const, email }
}
