import { registerPersonalActions } from '@/features/ai/registry/personal'

let bootstrapped = false

/** Personal OS only — import from PersonalAiPage, not from shared/workspace code. */
export function ensurePersonalAiRegistry() {
  if (bootstrapped) return
  registerPersonalActions()
  bootstrapped = true
}
