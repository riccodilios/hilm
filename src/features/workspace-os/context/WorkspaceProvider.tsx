import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getWorkspace, workspaceKeys, type WorkspaceWithMembership } from '@/features/workspace-os/api'
import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'
import {
  canDeleteWorkspace,
  canEditContent,
  canManageMembers,
  canManageWorkspace,
  seesAllWorkspaceData,
} from '@/features/workspace-os/lib/permissions'
import {
  canReadWorkspacePage,
  canWriteWorkspacePage,
  type MemberPagePermissions,
  type WorkspacePageKey,
} from '@/features/workspace-os/lib/page-permissions'
import { Skeleton } from '@/components/ui/page'

type WorkspaceContextValue = {
  workspaceId: string
  workspace: WorkspaceWithMembership
  role: WorkspaceRole
  pagePermissions: MemberPagePermissions
  seesAllData: boolean
  canReadPage: (page: WorkspacePageKey) => boolean
  canWritePage: (page: WorkspacePageKey) => boolean
  /** @deprecated Prefer canWritePage for the active page */
  canEdit: boolean
  canManage: boolean
  canManageTeam: boolean
  canDelete: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { workspaceId = '' } = useParams()
  const query = useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const value = useMemo(() => {
    if (!query.data) return null
    const role = query.data.my_role
    const pagePermissions = query.data.my_page_permissions
    const canReadPage = (page: WorkspacePageKey) =>
      canReadWorkspacePage(role, page, pagePermissions)
    const canWritePage = (page: WorkspacePageKey) =>
      canWriteWorkspacePage(role, page, pagePermissions)

    return {
      workspaceId,
      workspace: query.data,
      role,
      pagePermissions,
      seesAllData: seesAllWorkspaceData(role),
      canReadPage,
      canWritePage,
      canEdit: canEditContent(role),
      canManage: canManageWorkspace(role),
      canManageTeam: canManageMembers(role),
      canDelete: canDeleteWorkspace(role),
    } satisfies WorkspaceContextValue
  }, [query.data, workspaceId])

  if (query.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (query.isError || !value) {
    return (
      <div className="p-6 text-sm text-danger">
        {query.error instanceof Error ? query.error.message : 'Workspace unavailable'}
      </div>
    )
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
