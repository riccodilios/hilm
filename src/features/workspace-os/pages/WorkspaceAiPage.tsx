import { AiPage } from '@/features/ai/AiPage'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'

/** Thin Workspace OS wrapper around the shared AI engine. */
export function WorkspaceAiPage() {
  const { workspaceId, role } = useWorkspace()
  return <AiPage mode="workspace" workspaceId={workspaceId} workspaceRole={role} />
}
