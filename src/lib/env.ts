/**
 * Canonical app URL for auth redirects, deep links, and emails.
 * Never hardcode localhost in production — set VITE_APP_URL per environment.
 */
function readEnv(...keys: string[]) {
  for (const key of keys) {
    const value = (import.meta.env[key] as string | undefined)?.trim()
    if (value) return value
  }
  return undefined
}

function isLocalHost(url: string) {
  return /localhost|127\.0\.0\.1/i.test(url)
}

/**
 * Browser origin when available; otherwise env. Never returns a localhost URL
 * while the user is on a production host (guards against bad Netlify env).
 */
export function getAppUrl(): string {
  const fromEnv = readEnv(
    'VITE_APP_URL',
    'NEXT_PUBLIC_APP_URL',
    'VITE_SITE_URL',
    'NEXT_PUBLIC_SITE_URL',
  )?.replace(/\/$/, '')

  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin.replace(/\/$/, '')
    if (fromEnv) {
      // Production host must never emit localhost redirect URLs into emails.
      if (isLocalHost(fromEnv) && !isLocalHost(origin)) return origin
      // Prefer current origin in local/dev so redirects match the tab the user is on.
      if (isLocalHost(origin) && isLocalHost(fromEnv)) return origin
      return fromEnv
    }
    return origin
  }

  if (fromEnv) return fromEnv
  return ''
}

/** Absolute auth callback used as emailRedirectTo / redirectTo for Supabase Auth. */
export function getAuthCallbackUrl(next = '/onboarding'): string {
  const base = getAppUrl()
  if (!base) {
    console.warn('[hilm] getAppUrl() is empty — set VITE_APP_URL for reliable auth emails')
  }
  const params = new URLSearchParams({ next })
  return `${base}/auth/callback?${params.toString()}`
}

/** Alias used by confirmation emails and docs. */
export function getAuthConfirmUrl(next = '/onboarding'): string {
  return getAuthCallbackUrl(next)
}

export function getWorkspaceTaskDeepLink(
  workspaceId: string,
  taskId: string,
  projectId?: string | null,
): string {
  const base = getAppUrl()
  if (projectId) return `${base}/workspace/${workspaceId}/projects/${projectId}?task=${taskId}`
  return `${base}/workspace/${workspaceId}/tasks/${taskId}`
}

export function getTaskDeepLink(taskId: string, projectId?: string | null): string {
  const base = getAppUrl()
  if (projectId) return `${base}/personal/projects/${projectId}?task=${taskId}`
  return `${base}/personal/tasks/${taskId}`
}

export function getProjectDeepLink(projectId: string): string {
  return `${getAppUrl()}/personal/projects/${projectId}`
}

export function getSupabaseUrl() {
  return readEnv('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') ?? ''
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
