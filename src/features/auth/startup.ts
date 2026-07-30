import { getSettings } from '@/features/settings/api'
import type { StartupMode } from '@/features/workspace-os/lib/permissions'

export type PostAuthDestination = '/onboarding' | '/personal' | '/workspace'

export async function resolvePostAuthDestination(): Promise<PostAuthDestination> {
  try {
    const settings = await getSettings()
    if (!settings.onboarding_completed) return '/onboarding'
    if (settings.default_startup_mode === 'workspace') return '/workspace'
    return '/personal'
  } catch {
    return '/personal'
  }
}

export function personalPath(path = '') {
  const clean = path.replace(/^\//, '')
  return clean ? `/personal/${clean}` : '/personal'
}

export function workspacePath(workspaceId: string, path = '') {
  const clean = path.replace(/^\//, '')
  return clean ? `/workspace/${workspaceId}/${clean}` : `/workspace/${workspaceId}`
}

export type { StartupMode }
