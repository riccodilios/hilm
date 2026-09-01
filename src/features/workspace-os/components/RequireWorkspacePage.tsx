import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import type { WorkspacePageKey } from '@/features/workspace-os/lib/page-permissions'

const PATH_TO_PAGE: Array<{ prefix: string; page: WorkspacePageKey }> = [
  { prefix: '/tasks', page: 'tasks' },
  { prefix: '/projects', page: 'projects' },
  { prefix: '/ai', page: 'ai' },
  { prefix: '/team-lead', page: 'team-lead' },
  { prefix: '/team', page: 'team' },
  { prefix: '/org', page: 'org' },
  { prefix: '/crm', page: 'crm' },
  { prefix: '/profile', page: 'profile' },
  { prefix: '/activity', page: 'activity' },
  { prefix: '/reports', page: 'reports' },
  { prefix: '/mission-control', page: 'mission-control' },
]

export function resolveWorkspacePageFromPath(pathname: string): WorkspacePageKey {
  const base = pathname.replace(/\/workspace\/[^/]+/, '') || '/'
  for (const entry of PATH_TO_PAGE) {
    if (base === entry.prefix || base.startsWith(`${entry.prefix}/`)) {
      return entry.page
    }
  }
  return 'home'
}

export function RequireWorkspacePage({
  page,
  children,
}: {
  page: WorkspacePageKey
  children: ReactNode
}) {
  const { workspaceId, canReadPage } = useWorkspace()
  const location = useLocation()
  const resolved = page ?? resolveWorkspacePageFromPath(location.pathname)

  if (!canReadPage(resolved)) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface/40 p-6 text-sm text-muted">
        You do not have access to this page. Ask your workspace owner to grant access.
        <div className="mt-4">
          <a href={`/workspace/${workspaceId}`} className="text-foreground underline">
            Back to home
          </a>
        </div>
      </div>
    )
  }

  return children
}

export function WorkspacePageGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const page = resolveWorkspacePageFromPath(location.pathname)
  return <RequireWorkspacePage page={page}>{children}</RequireWorkspacePage>
}
