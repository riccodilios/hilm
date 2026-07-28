/**
 * Canonical app URL for auth redirects, deep links, and emails.
 * Never hardcode localhost in production — set VITE_APP_URL / APP_URL per environment.
 */
export function getAppUrl(): string {
  const fromEnv =
    (import.meta.env.VITE_APP_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_SITE_URL as string | undefined)?.trim()

  if (fromEnv) {
    return fromEnv.replace(/\/$/, '')
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }

  // Build-time fallback only (SSR / tooling). Prefer configuring VITE_APP_URL.
  return ''
}

export function getAuthCallbackUrl(next = '/app'): string {
  const base = getAppUrl()
  const params = new URLSearchParams({ next })
  return `${base}/auth/callback?${params.toString()}`
}

export function getTaskDeepLink(taskId: string, projectId?: string | null): string {
  const base = getAppUrl()
  if (projectId) return `${base}/app/projects/${projectId}?task=${taskId}`
  return `${base}/app/tasks/${taskId}`
}

export function getProjectDeepLink(projectId: string): string {
  return `${getAppUrl()}/app/projects/${projectId}`
}

export const isDev = import.meta.env.DEV
export const isProd = import.meta.env.PROD
