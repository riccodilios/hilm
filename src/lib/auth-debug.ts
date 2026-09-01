import { isDev } from '@/lib/env'

type AuthDebugPayload = Record<string, string | number | boolean | null | undefined>

/** Dev-only auth diagnostics — never log secrets, tokens, passwords, or OTP values. */
export function authDebug(event: string, payload?: AuthDebugPayload) {
  if (!isDev) return
  const safe = payload ? redactAuthPayload(payload) : undefined
  if (safe && Object.keys(safe).length) {
    console.info(`[HILM AUTH DEBUG] ${event}`, safe)
  } else {
    console.info(`[HILM AUTH DEBUG] ${event}`)
  }
}

function redactAuthPayload(payload: AuthDebugPayload): AuthDebugPayload {
  const blocked = new Set([
    'password',
    'access_token',
    'refresh_token',
    'token',
    'otp',
    'token_hash',
    'apikey',
    'api_key',
    'smtp_pass',
    'smtp_password',
  ])
  const out: AuthDebugPayload = {}
  for (const [key, value] of Object.entries(payload)) {
    if (blocked.has(key.toLowerCase())) continue
    if (typeof value === 'string' && value.length > 120) {
      out[key] = `${value.slice(0, 80)}…(${value.length} chars)`
      continue
    }
    out[key] = value
  }
  return out
}

export const PENDING_VERIFY_EMAIL_KEY = 'hilm_pending_verify_email'

export function rememberPendingVerifyEmail(email: string) {
  try {
    sessionStorage.setItem(PENDING_VERIFY_EMAIL_KEY, email.trim().toLowerCase())
  } catch {
    // ignore storage failures
  }
}

export function readPendingVerifyEmail() {
  try {
    return sessionStorage.getItem(PENDING_VERIFY_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function clearPendingVerifyEmail() {
  try {
    sessionStorage.removeItem(PENDING_VERIFY_EMAIL_KEY)
  } catch {
    // ignore
  }
}
