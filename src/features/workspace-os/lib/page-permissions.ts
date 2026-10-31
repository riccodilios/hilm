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
  'mission-control': { read: true, write: false },
  'team-lead': { read: false, write: false },
}

/** Viewers read the core pages and never write. */
export const DEFAULT_VIEWER_PAGE_PERMISSIONS: MemberPagePermissions = {
  home: { read: true, write: false },
  projects: { read: true, write: false },
  tasks: { read: true, write: false },
  ai: { read: false, write: false },
  team: { read: true, write: false },
  org: { read: false, write: false },
  crm: { read: false, write: false },
  profile: { read: false, write: false },
  activity: { read: true, write: false },
  reports: { read: true, write: false },
  'mission-control': { read: true, write: false },
  'team-lead': { read: false, write: false },
}

export type PageAccessContext = {
  /** Leads a team or heads a department: the team lead inbox is where their work arrives. */
  leadsPeople?: boolean
}

export function hasFullWorkspaceAccess(role: WorkspaceRole | null | undefined) {
  return role === 'owner' || role === 'admin'
}

export function defaultPageAccess(
  role: WorkspaceRole | null | undefined,
  page: WorkspacePageKey,
  context?: PageAccessContext,
): PageAccess {
  if (hasFullWorkspaceAccess(role)) return { read: true, write: true }
  if (role === 'viewer') return DEFAULT_VIEWER_PAGE_PERMISSIONS[page] ?? { read: false, write: false }
  if (page === 'team-lead' && context?.leadsPeople) return { read: true, write: true }
  return DEFAULT_MEMBER_PAGE_PERMISSIONS[page] ?? { read: false, write: false }
}

export function defaultPagePermissions(
  role: WorkspaceRole | null | undefined,
  context?: PageAccessContext,
): MemberPagePermissions {
  return Object.fromEntries(
    WORKSPACE_PAGES.map((page) => [page, defaultPageAccess(role, page, context)]),
  ) as MemberPagePermissions
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
  context?: PageAccessContext,
): PageAccess {
  if (hasFullWorkspaceAccess(role)) {
    return { read: true, write: true }
  }
  const custom = overrides?.[page]
  const access = custom
    ? { read: custom.read, write: custom.write && custom.read }
    : defaultPageAccess(role, page, context)
  // The database refuses viewer writes; never offer them in the UI either.
  return role === 'viewer' ? { read: access.read, write: false } : access
}

export function canReadWorkspacePage(
  role: WorkspaceRole | null | undefined,
  page: WorkspacePageKey,
  overrides?: MemberPagePermissions | null,
  context?: PageAccessContext,
) {
  return resolvePageAccess(role, page, overrides, context).read
}

export function canWriteWorkspacePage(
  role: WorkspaceRole | null | undefined,
  page: WorkspacePageKey,
  overrides?: MemberPagePermissions | null,
  context?: PageAccessContext,
) {
  return resolvePageAccess(role, page, overrides, context).write
}
