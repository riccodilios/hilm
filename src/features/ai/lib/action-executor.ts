import {
  buildActionCatalogPrompt,
  extractRegistryActionsFromContent,
  getRegisteredAction,
  maxRisk,
  parseRegistryActions,
} from '@/features/ai/registry'
import { ensureAiRegistry } from '@/features/ai/registry/bootstrap'
import type { ActionContext, ActionRisk, ParsedRegistryAction } from '@/features/ai/registry/types'

export type ActionExecutionResult = {
  action: ParsedRegistryAction
  success: boolean
  data?: unknown
  summary?: string
  error?: string
}

export type ExecuteAiActionsOptions = {
  workspaceId?: string
  role?: ActionContext['role']
  /** When true, stop after first failure (default for multi-step plans). */
  sequential?: boolean
}

ensureAiRegistry()

export function getActionRisk(actions: ParsedRegistryAction[], os?: ActionContext['os']): ActionRisk {
  return maxRisk(actions, os)
}

export function parseActionsForOs(
  value: unknown,
  options?: { workspaceId?: string; role?: ActionContext['role'] },
) {
  ensureAiRegistry()
  const os = options?.workspaceId ? 'workspace' : 'personal'
  const ctx: ActionContext = {
    os,
    workspaceId: options?.workspaceId,
    role: options?.role,
  }
  return parseRegistryActions(value, os, ctx)
}

export function extractActionsFromContent(
  content: string,
  options?: { workspaceId?: string; role?: ActionContext['role'] },
) {
  ensureAiRegistry()
  const os = options?.workspaceId ? 'workspace' : 'personal'
  const ctx: ActionContext = {
    os,
    workspaceId: options?.workspaceId,
    role: options?.role,
  }
  return extractRegistryActionsFromContent(content, os, ctx)
}

export function buildOsActionPrompt(
  workspaceId?: string,
  role?: ActionContext['role'],
) {
  ensureAiRegistry()
  const os = workspaceId ? 'workspace' : 'personal'
  return buildActionCatalogPrompt(os, { os, workspaceId, role })
}

export async function executeAiActions(
  input: ParsedRegistryAction[],
  options?: ExecuteAiActionsOptions,
): Promise<ActionExecutionResult[]> {
  ensureAiRegistry()
  const workspaceId = options?.workspaceId
  const os = workspaceId ? 'workspace' : 'personal'
  const ctx: ActionContext = {
    os,
    workspaceId,
    role: options?.role,
  }

  const actions = parseRegistryActions(input, os, ctx)
  if (!actions.length) {
    return input.map((action) => ({
      action,
      success: false,
      error: 'Action payload was invalid or not permitted',
    }))
  }

  const sequential = options?.sequential ?? true
  const results: ActionExecutionResult[] = []

  for (const action of actions) {
    const def = getRegisteredAction(action.type, os)
    if (!def) {
      results.push({ action, success: false, error: `Unknown action ${action.type}` })
      if (sequential) break
      continue
    }
    if (def.permission && !def.permission(ctx)) {
      results.push({ action, success: false, error: 'Permission denied for this action' })
      if (sequential) break
      continue
    }
    if (os === 'workspace' && !workspaceId) {
      results.push({ action, success: false, error: 'Missing workspace id' })
      if (sequential) break
      continue
    }

    try {
      const outcome = await def.execute(action, ctx)
      results.push({
        action,
        success: outcome.ok,
        data: outcome.data,
        summary: outcome.summary,
        error: outcome.ok ? undefined : outcome.summary,
      })
      if (!outcome.ok && sequential) break
    } catch (error) {
      results.push({
        action,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute action',
      })
      if (sequential) break
    }
  }

  return results
}

/** @deprecated Prefer extractActionsFromContent */
export { extractActionsFromContent as extractAiActionsFromContent }
