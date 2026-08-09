/** Safe URL helpers for markdown, rich text, and push deep links. */

const SAFE_HREF = /^(https?:|mailto:|tel:|\/|#)/i
const DANGEROUS_PROTOCOL = /^(javascript|data|vbscript|file):/i

export function isSafeHref(href: string | null | undefined): boolean {
  if (!href) return false
  const trimmed = href.trim()
  if (!trimmed || DANGEROUS_PROTOCOL.test(trimmed)) return false
  if (trimmed.startsWith('//')) return false
  return SAFE_HREF.test(trimmed)
}

/** http(s) only — for TipTap / external opens. */
export function isHttpUrl(href: string | null | undefined): boolean {
  if (!href) return false
  try {
    const url = new URL(href.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Same-origin app path for service-worker notification clicks. */
export function sameOriginAppPath(href: string | null | undefined, origin: string): string {
  const fallback = '/personal'
  if (!href?.trim()) return fallback
  try {
    const url = new URL(href.trim(), origin)
    if (url.origin !== origin) return fallback
    const path = `${url.pathname}${url.search}${url.hash}`
    if (!path.startsWith('/') || path.startsWith('//')) return fallback
    return path
  } catch {
    return fallback
  }
}
