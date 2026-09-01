import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AiChatShell } from '@/shared/ai/AiChatShell'
import {
  coalesceWorkspaceTaskCreates,
  expandCreateManyForDisplay,
} from '@/features/workspace-os/lib/batch-engine'
import { useWorkspacePreviewDirectory } from '@/features/workspace-os/lib/use-workspace-preview-directory'
import { workspaceKeys } from '@/features/workspace-os/api'
import { workspaceLabelKeys } from '@/features/workspace-os/labels-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { ensureWorkspaceAiRegistry } from '@/features/workspace-os/ai/registry/bootstrap'
import type { AiAction } from '@/types/ai-actions'

/** Thin Workspace OS wrapper around the shared AI chat shell. */

ensureWorkspaceAiRegistry()

export function WorkspaceAiPage() {
  const { workspaceId, role } = useWorkspace()
  const queryClient = useQueryClient()
  const previewDirectory = useWorkspacePreviewDirectory(workspaceId, true)

  const onInvalidateAfterActions = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: workspaceKeys.activity(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: workspaceLabelKeys.all(workspaceId) }),
    ])
  }, [queryClient, workspaceId])

  const transformProposedActions = useCallback(
    (actions: AiAction[]) => coalesceWorkspaceTaskCreates(actions as never) as AiAction[],
    [],
  )

  return (
    <AiChatShell
      mode="workspace"
      workspaceId={workspaceId}
      workspaceRole={role}
      previewDirectory={previewDirectory}
      onInvalidateAfterActions={onInvalidateAfterActions}
      coalesceCreates
      expandCreateManyForDisplay={expandCreateManyForDisplay}
      transformProposedActions={transformProposedActions}
    />
  )
}
