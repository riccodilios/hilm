/**
 * Canonical app URL for auth redirects, deep links, and emails.
 * Never hardcode localhost in production — set VITE_APP_URL / NEXT_PUBLIC_APP_URL per environment.
 */
function readEnv(...keys: string[]) {
  for (const key of keys) {
    const value = (import.meta.env[key] as string | undefined)?.trim()
    if (value) return value
  }
  return undefined
}

export function getAppUrl(): string {
  const fromEnv = readEnv(
    'VITE_APP_URL',
    'NEXT_PUBLIC_APP_URL',
    'VITE_SITE_URL',
    'NEXT_PUBLIC_SITE_URL',
  )

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

export function getSupabaseUrl() {
  return (
    readEnv('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') ?? ''
  )
}

export function getSupabaseAnonKey() {
  return (
    readEnv(
      'VITE_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ) ?? ''
  )
}

export const isDev = import.meta.env.DEV
export const isProd = import.meta.env.PROD
