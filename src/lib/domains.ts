/**
 * Production domain split: hilm.tech is the public site (landing, privacy), app.hilm.tech runs
 * the product. Other hosts (localhost, deploy previews, hillm.netlify.app) serve everything.
 * netlify.toml mirrors these rules server-side for direct visits.
 */
export const MARKETING_ORIGIN = 'https://hilm.tech'
export const APP_ORIGIN = 'https://app.hilm.tech'

const MARKETING_HOSTS = new Set(['hilm.tech', 'www.hilm.tech'])
const APP_HOSTS = new Set(['app.hilm.tech'])
const MARKETING_PATHS = new Set(['/', '/privacy'])

export type DomainRedirect = { kind: 'external'; url: string } | { kind: 'internal'; to: string } | null

export function domainRedirect(location: { host: string; pathname: string; search: string; hash: string }): DomainRedirect {
  const host = location.host.toLowerCase()
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const rest = `${location.search}${location.hash}`
  if (MARKETING_HOSTS.has(host)) {
    return MARKETING_PATHS.has(path) ? null : { kind: 'external', url: `${APP_ORIGIN}${location.pathname}${rest}` }
  }
  if (APP_HOSTS.has(host)) {
    if (path === '/privacy') return { kind: 'external', url: `${MARKETING_ORIGIN}/privacy${rest}` }
    // The app has no landing page; signed-in users continue from /login to their workspace.
    if (path === '/') return { kind: 'internal', to: `/login${rest}` }
  }
  return null
}
