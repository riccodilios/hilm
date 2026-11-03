import { openPlanPrompt, workspaceIdFromPath } from '@/shared/billing/plan-prompt'
import { promptForAiCode } from '@/shared/billing/recommend'

type AiLimitPayload = {
  error?: string
  code?: string
  message?: string
  /** Which subscription the rejected request belonged to (set by the server guard). */
  scope?: 'personal' | 'workspace'
  workspaceId?: string | null
}

export function formatAiLimitError(payload: AiLimitPayload) {
  const code = payload.code
  const fallback = payload.error || payload.message || 'AI request failed'
  // Workspace limits come with the server's workspace-specific wording.
  if (payload.scope === 'workspace' && (payload.error || payload.message)) return fallback
  switch (code) {
    case 'rate_limited':
      return 'You are sending AI requests too quickly. Please wait a moment and try again.'
    case 'daily_request_limit':
      return 'You have reached your daily AI request limit. It resets at midnight UTC.'
    case 'monthly_request_limit':
      return 'You have reached your monthly AI request limit.'
    case 'daily_token_limit':
      return 'You have reached your daily AI token quota.'
    case 'monthly_token_limit':
      return 'You have reached your monthly AI token quota.'
    case 'daily_cost_limit':
      return 'You have reached your daily AI spend limit.'
    case 'monthly_cost_limit':
      return 'You have reached your monthly AI spend limit.'
    case 'global_cost_limit':
      return 'Hilm AI is paused for today because the service budget was reached. Please try again tomorrow.'
    case 'concurrent_limit':
    case 'in_flight':
    case 'duplicate_execution':
      return 'Another AI request is already running. Please wait for it to finish.'
    case 'duplicate':
      return 'This AI request was already submitted.'
    case 'tier_disabled':
      return 'AI access is disabled for your plan. Contact support.'
    default:
      return fallback
  }
}

/** Opens the matching plan explanation for a quota rejection (personal or workspace, never mixed). */
export function announceAiLimit(payload: AiLimitPayload) {
  const scope = payload.scope ?? (workspaceIdFromPath() ? 'workspace' : 'personal')
  const reason = promptForAiCode(payload.code, scope)
  if (!reason) return
  openPlanPrompt({ reason, workspaceId: scope === 'workspace' ? (payload.workspaceId ?? workspaceIdFromPath()) : null })
}
