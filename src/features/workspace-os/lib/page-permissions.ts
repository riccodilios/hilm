import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'

export const WORKSPACE_PAGES = [
  'home',
  'projects',
  'tasks',
  'ai',
  'team',
  'org',
  'crm',
  'profile',
  'activity',
  'reports',
  'mission-control',
  'team-lead',
] as const

export type WorkspacePageKey = (typeof WORKSPACE_PAGES)[number]

export type PageAccess = { read: boolean; write: boolean }

export type MemberPagePermissions = Partial<Record<WorkspacePageKey, PageAccess>>

export const PAGE_LABELS: Record<WorkspacePageKey, string> = {
  home: 'Home',
  projects: 'Projects',
  tasks: 'Tasks',
  ai: 'AI',
  team: 'Team',
  org: 'Org chart',
  crm: 'CRM',
  profile: 'Profile',
  activity: 'Activity',
  reports: 'Reports',
  'mission-control': 'Mission control',
  'team-lead': 'Team lead inbox',
}

/** Default page access for regular members (owner can override per member). */
export const DEFAULT_MEMBER_PAGE_PERMISSIONS: MemberPagePermissions = {
  home: { read: true, write: true },
  projects: { read: true, write: true },
  tasks: { read: true, write: true },
  ai: { read: true, write: true },
  team: { read: true, write: false },
  org: { read: false, write: false },
  crm: { read: false, write: false },
  profile: { read: true, write: true },
  activity: { read: true, write: false },
  reports: { read: true, write: true },
  'mission-control': { read: true, write: true },
  'team-lead': { read: true, write: true },
}

export function hasFullWorkspaceAccess(role: WorkspaceRole | null | undefined) {
  return role === 'owner' || role === 'admin'
}

export function normalizePagePermissions(raw: unknown): MemberPagePermissions {
  if (!raw || typeof raw !== 'object') return {}
  const out: MemberPagePermissions = {}
  for (const page of WORKSPACE_PAGES) {
    const entry = (raw as Record<string, unknown>)[page]
    if (!entry || typeof entry !== 'object') continue
    const read = (entry as PageAccess).read === true
    const write = (entry as PageAccess).write === true
    out[page] = { read, write }
  }
  return out
}

export function resolvePageAccess(
  role: WorkspaceRole | null | undefined,
  page: WorkspacePageKey,
  overrides: MemberPagePermissions | null | undefined,
): PageAccess {
  if (hasFullWorkspaceAccess(role)) {
    return { read: true, write: true }
  }
  const custom = overrides?.[page]
  if (custom) return { read: custom.read, write: custom.write && custom.read }
  const defaults = DEFAULT_MEMBER_PAGE_PERMISSIONS[page]
  if (defaults) return defaults
  return { read: false, write: false }
}

export function canReadWorkspacePage(
  role: WorkspaceRole | null | undefined,
  page: WorkspacePageKey,
  overrides?: MemberPagePermissions | null,
) {
  return resolvePageAccess(role, page, overrides).read
}

export function canWriteWorkspacePage(
  role: WorkspaceRole | null | undefined,
  page: WorkspacePageKey,
  overrides?: MemberPagePermissions | null,
) {
  return resolvePageAccess(role, page, overrides).write
}
