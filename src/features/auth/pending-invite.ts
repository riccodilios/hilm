/**
 * Keeps a workspace invite code across sign-in / sign-up / onboarding, so an emailed invite link
 * opened while signed out still ends with the join dialog. Stored for 7 days on this device.
 */
const KEY = 'hilm-pending-invite'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const CODE_RE = /^[A-Za-z0-9-]{4,32}$/

export function rememberPendingInvite(code: string | null | undefined) {
  if (!code || !CODE_RE.test(code)) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }))
  } catch {
    // Storage unavailable: the user can still paste the code from the email.
  }
}

export function pendingInvite(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown }
    if (typeof parsed.code !== 'string' || !CODE_RE.test(parsed.code)) return null
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) {
      localStorage.removeItem(KEY)
      return null
    }
    return parsed.code
  } catch {
    return null
  }
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

/** Where to continue after auth when an invite is waiting. */
export function pendingInvitePath() {
  const code = pendingInvite()
  return code ? `/workspace?join=${encodeURIComponent(code)}` : null
}
