import {
  buildActionCatalogPrompt,
  extractRegistryActionsFromContent,
  getRegisteredAction,
  maxRisk,
  parseRegistryActions,
  coerceActionsList,
} from '@/features/ai/registry'
import { ensureAiRegistry } from '@/features/ai/registry/bootstrap'
import { normalizeAiAction } from '@/features/ai/registry/schemas'
import { auditAiAction } from '@/features/ai/lib/conversation-focus'
import { rewriteActionsForConversationFocus } from '@/features/ai/lib/rewrite-actions'
import { coalesceWorkspaceTaskCreates } from '@/features/ai/lib/batch-engine'
import type { ActionContext, ActionRisk, ParsedRegistryAction } from '@/features/ai/registry/types'

export type ActionExecutionResult = {
  action: ParsedRegistryAction
  success: boolean
  data?: unknown
  summary?: string
  error?: string
  entities?: Array<{ type: string; id: string }>
}

export type ExecuteAiActionsOptions = {
  workspaceId?: string
  role?: ActionContext['role']
  /** When true, stop after first failure (default for multi-step plans). */
  sequential?: boolean
  /**
   * When true (default for workspace), collapse many task.create into task.create_many.
   * Personal OS is never coalesced.
   */
  coalesceCreates?: boolean
  userMessage?: string
  conversationFocus?: import('@/features/ai/lib/conversation-focus').ConversationEntityFocus | null
  onProgress?: (event: {
    actionIndex: number
    action: ParsedRegistryAction
    phase: 'start' | 'item' | 'done' | 'error'
    itemIndex?: number
    summary?: string
    error?: string
  }) => void
}

ensureAiRegistry()

function actionTaskId(action: ParsedRegistryAction): string | null {
  const value = action['taskId']
  return typeof value === 'string' ? value : null
}

/** Pull a human-readable message from Error, Postgrest plain objects, Zod, strings, etc. */
export function formatActionError(error: unknown, fallback = 'Failed to execute action'): string {
  if (error == null) return fallback
  if (typeof error === 'string') {
    const trimmed = error.trim()
    return mapCoerceError(trimmed) || fallback
  }
  if (error instanceof Error) {
    const message = error.message?.trim()
    if (message) return mapCoerceError(message)
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    const code = typeof record.code === 'string' ? record.code : ''
    const message = typeof record.message === 'string' ? record.message.trim() : ''
    if (code === 'PGRST116' || /coerce the result to a single json object/i.test(message)) {
      return 'Record not found or you do not have access to it'
    }
    if (
      code === '23503' ||
      /workspace_tasks_project_id_fkey|is not present in table \"workspace_projects\"/i.test(message)
    ) {
      return 'I couldn’t create the task because I couldn’t find that project in this workspace. Would you like me to create the project first?'
    }
    for (const key of ['message', 'error', 'details', 'hint'] as const) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    // ZodError-like
    if (Array.isArray(record.issues) && record.issues.length) {
      const issue = record.issues[0] as { message?: unknown; path?: unknown }
      const path = Array.isArray(issue.path) ? issue.path.join('.') : ''
      const msg = typeof issue.message === 'string' ? issue.message : 'Invalid input'
      return path ? `${path}: ${msg}` : msg
    }
  }
  try {
    return JSON.stringify(error)
  } catch {
    return fallback
  }
}

function mapCoerceError(message: string) {
  if (/coerce the result to a single json object/i.test(message)) {
    return 'Record not found or you do not have access to it'
  }
  if (
    /23503|foreign key|workspace_tasks_project_id_fkey|Key \(project_id\)|is not present in table \"workspace_projects\"/i.test(
      message,
    )
  ) {
    return 'I couldn’t create the task because I couldn’t find that project in this workspace. Would you like me to create the project first?'
  }
  if (/409|Conflict/i.test(message) && /workspace_tasks|project_id/i.test(message)) {
    return 'I couldn’t create the task because I couldn’t find that project in this workspace.'
  }
  return message
}

function formatZodIssues(error: { issues?: Array<{ path: PropertyKey[]; message: string }> }) {
  const issues = error.issues ?? []
  if (!issues.length) return 'Action payload was invalid'
  return issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.filter((part) => part !== undefined && part !== '').join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join(' · ')
}

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
    conversationFocus: options?.conversationFocus,
  }

  const sequential = options?.sequential ?? true
  const results: ActionExecutionResult[] = []
  const rewritten = rewriteActionsForConversationFocus(coerceActionsList(input), {
    userMessage: options?.userMessage,
    focus: options?.conversationFocus,
  })
  const list =
    os === 'workspace' && options?.coalesceCreates !== false
      ? coalesceWorkspaceTaskCreates(rewritten)
      : rewritten

  if (!list.length) {
    return (input?.length ? input : [{ type: 'unknown' }]).map((action) => ({
      action,
      success: false,
      error: 'Action payload was invalid or not permitted',
    }))
  }

  for (const raw of list) {
    const normalized = normalizeAiAction(raw) as ParsedRegistryAction
    const type = typeof normalized.type === 'string' ? normalized.type.trim() : ''
    const action = { ...normalized, type }

    auditAiAction({
      phase: 'select',
      userRequest: options?.userMessage,
      intent: type.split('.')[1] ?? type,
      tool: type,
      targetId: actionTaskId(action),
      params: action,
    })

    if (!type) {
      results.push({ action, success: false, error: 'Action is missing a type' })
      if (sequential) break
      continue
    }

    const def = getRegisteredAction(type, os)
    if (!def) {
      results.push({ action, success: false, error: `Unknown action ${type}` })
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

    const parsed = def.inputSchema.safeParse(action)
    if (!parsed.success) {
      console.error('[hilm] AI action schema rejected', {
        os,
        workspaceId,
        type,
        issues: parsed.error.issues,
        action,
      })
      results.push({
        action,
        success: false,
        error: formatZodIssues(parsed.error),
      })
      if (sequential) break
      continue
    }

    try {
      options?.onProgress?.({
        actionIndex: results.length,
        action: parsed.data as ParsedRegistryAction,
        phase: 'start',
      })
      const outcome = await def.execute(parsed.data, ctx)
      results.push({
        action: parsed.data as ParsedRegistryAction,
        success: outcome.ok,
        data: outcome.data,
        summary: outcome.summary,
        entities: outcome.entities,
        error: outcome.ok ? undefined : outcome.summary || 'Action did not complete',
      })
      options?.onProgress?.({
        actionIndex: results.length - 1,
        action: parsed.data as ParsedRegistryAction,
        phase: outcome.ok ? 'done' : 'error',
        summary: outcome.summary,
        error: outcome.ok ? undefined : outcome.summary,
      })
      auditAiAction({
        phase: 'result',
        tool: type,
        targetId: actionTaskId(action) ?? outcome.entities?.[0]?.id,
        result: { ok: outcome.ok, summary: outcome.summary, entities: outcome.entities },
        error: outcome.ok ? undefined : outcome.summary,
      })
      if (!outcome.ok) {
        console.error('[hilm] AI action soft-failed', {
          os,
          workspaceId,
          type,
          taskId: actionTaskId(parsed.data as ParsedRegistryAction),
          summary: outcome.summary,
          action: parsed.data,
        })
      }
      // Batch creates already continue internally — don't abort the whole plan on partial success.
      const isPartialBatch =
        type === 'task.create_many' &&
        outcome.data &&
        typeof outcome.data === 'object' &&
        'succeeded' in outcome.data &&
        Number((outcome.data as { succeeded?: unknown }).succeeded) > 0
      if (!outcome.ok && sequential && !isPartialBatch) break
    } catch (error) {
      console.error('[hilm] AI action failed', {
        os,
        workspaceId,
        type,
        taskId: actionTaskId(parsed.data as ParsedRegistryAction),
        action: parsed.data,
        error,
      })
      results.push({
        action: parsed.data as ParsedRegistryAction,
        success: false,
        error: formatActionError(error),
      })
      auditAiAction({
        phase: 'error',
        tool: type,
        targetId: actionTaskId(action),
        error,
      })
      if (sequential) break
    }
  }

  return results
}

/** @deprecated Prefer extractActionsFromContent */
export { extractActionsFromContent as extractAiActionsFromContent }
