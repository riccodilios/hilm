import type { ReactNode } from 'react'
import { createContext, useContext, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getWorkspace, workspaceKeys, type Workspace } from '@/features/workspace-os/api'
import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'
import {
  canDeleteWorkspace,
  canEditContent,
  canManageMembers,
  canManageWorkspace,
} from '@/features/workspace-os/lib/permissions'
import { Skeleton } from '@/components/ui/page'

type WorkspaceContextValue = {
  workspaceId: string
  workspace: Workspace & { my_role: WorkspaceRole }
  role: WorkspaceRole
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
    return {
      workspaceId,
      workspace: query.data,
      role,
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
