/**
 * Compatibility layer — AI actions are defined in the registry.
 * Prefer `@/features/ai/registry` and `@/features/ai/lib/action-executor`.
 */
import { ensureAiRegistry } from '@/features/ai/registry/bootstrap'
import {
  extractActionsFromContent,
  parseActionsForOs,
} from '@/features/ai/lib/action-executor'
import type { ParsedRegistryAction } from '@/features/ai/registry/types'
import { normalizeAiAction } from '@/features/ai/registry/schemas'

ensureAiRegistry()

export type AiAction = ParsedRegistryAction

export function parseAiActions(value: unknown): AiAction[] {
  return parseActionsForOs(value)
}

export function extractAiActionsFromContent(content: string): AiAction[] {
  return extractActionsFromContent(content)
}

export { normalizeAiAction }
