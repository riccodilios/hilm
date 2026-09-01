import type { Database } from '@/types/database'

export type WorkspaceRole = Database['public']['Enums']['workspace_role']
export type StartupMode = Database['public']['Enums']['startup_mode']

export function canView(_role: WorkspaceRole | null | undefined) {
  return Boolean(_role)
}

export function canEditContent(role: WorkspaceRole | null | undefined) {
  return role === 'owner' || role === 'admin' || role === 'member'
}

export function canManageMembers(role: WorkspaceRole | null | undefined) {
  return role === 'owner' || role === 'admin'
}

export function canManageWorkspace(role: WorkspaceRole | null | undefined) {
  return role === 'owner' || role === 'admin'
}

export function canDeleteWorkspace(role: WorkspaceRole | null | undefined) {
  return role === 'owner'
}

export function canTransferOwnership(role: WorkspaceRole | null | undefined) {
  return role === 'owner'
}

export function isWorkspaceOwner(role: WorkspaceRole | null | undefined) {
  return role === 'owner'
}

export function seesAllWorkspaceData(role: WorkspaceRole | null | undefined) {
  return role === 'owner' || role === 'admin'
}
