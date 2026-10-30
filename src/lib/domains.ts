/**
 * Production domain split: hilm.tech is the public site, app.hilm.tech runs the product, and the
 * retired hillm.netlify.app host forwards to whichever of the two serves the path.
 * Other hosts (localhost, deploy previews) serve everything.
 * netlify.toml mirrors these rules server-side for direct visits.
 */
import { SITE, matchPublicPath } from '@/content/site.ts'

export const MARKETING_ORIGIN = SITE.origin
export const APP_ORIGIN = SITE.appOrigin

const MARKETING_HOSTS = new Set(['hilm.tech', 'www.hilm.tech'])
const APP_HOSTS = new Set(['app.hilm.tech'])
const RETIRED_HOSTS = new Set(['hillm.netlify.app'])

export type DomainRedirect = { kind: 'external'; url: string } | { kind: 'internal'; to: string } | null

/** Public marketing pages (both languages), as opposed to the authenticated product. */
export function isPublicSitePath(pathname: string) {
  return matchPublicPath(pathname) !== null
}

export function domainRedirect(location: { host: string; pathname: string; search: string; hash: string }): DomainRedirect {
  const host = location.host.toLowerCase()
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const rest = `${location.search}${location.hash}`
  const isPublic = isPublicSitePath(path)
  if (MARKETING_HOSTS.has(host)) {
    return isPublic ? null : { kind: 'external', url: `${APP_ORIGIN}${location.pathname}${rest}` }
  }
  if (APP_HOSTS.has(host)) {
    // The app has no landing page; signed-in users continue from /login to their workspace.
    if (path === '/') return { kind: 'internal', to: `/login${rest}` }
    if (isPublic) return { kind: 'external', url: `${MARKETING_ORIGIN}${path}${rest}` }
  }
  if (RETIRED_HOSTS.has(host)) {
    return { kind: 'external', url: `${isPublic ? MARKETING_ORIGIN : APP_ORIGIN}${location.pathname}${rest}` }
  }
  return null
}
