import { fetchSettings } from '@/features/settings/api'
import { pendingInvitePath } from '@/features/auth/pending-invite'
import type { StartupMode } from '@/features/workspace-os/lib/permissions'

export type PostAuthDestination = '/onboarding' | '/personal' | '/workspace' | `/workspace?join=${string}`

export async function resolvePostAuthDestination(): Promise<PostAuthDestination> {
  try {
    const settings = await fetchSettings()
    if (!settings.onboarding_completed) return '/onboarding'
    const invite = pendingInvitePath()
    if (invite) return invite as PostAuthDestination
    // Hidden Workspace OS means Personal-only — never send them to the selector.
    if (settings.hide_workspace_os) return '/personal'
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
