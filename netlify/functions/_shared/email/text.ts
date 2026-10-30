/** Escaping and validation for anything user-controlled that ends up in an email. */

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// C0/C1 controls, bidi overrides/isolates, zero-width and line/paragraph separators.
// oxlint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g

/** One line of plain text: no CR/LF or control characters, collapsed spaces, clamped. */
export function singleLine(value: string | null | undefined, max = 200) {
  const cleaned = String(value ?? '')
    .replace(UNSAFE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** A single plain address (no display name, list, or header-breaking characters). */
export function isValidEmailAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length > 254 || value !== value.trim()) return false
  if (value.includes('..')) return false
  return EMAIL_RE.test(value)
}

/** Absolute link under the configured app origin; rejects anything that is not a plain path. */
export function appLink(appBaseUrl: string, path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || /[\s\\]/.test(path)) {
    throw new Error('Email links must be app-relative paths')
  }
  return `${appBaseUrl}${path}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
