import { registerPersonalActions } from '@/features/ai/registry/personal'
import { registerWorkspaceActions } from '@/features/ai/registry/workspace'

let bootstrapped = false

/** Idempotent registration of all AI actions for both OS surfaces. */
export function ensureAiRegistry() {
  if (bootstrapped) return
  registerPersonalActions()
  registerWorkspaceActions()
  bootstrapped = true
}
