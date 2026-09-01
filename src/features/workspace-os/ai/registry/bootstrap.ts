import { registerWorkspaceActions } from '@/features/workspace-os/ai/registry/workspace'

let bootstrapped = false

export function ensureWorkspaceAiRegistry() {
  if (bootstrapped) return
  registerWorkspaceActions()
  bootstrapped = true
}
