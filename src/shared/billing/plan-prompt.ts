import type { PlanPromptReason, WorkspacePlanId } from '@/shared/billing/recommend'

export type PlanPromptDetail = {
  reason: PlanPromptReason
  workspaceId?: string | null
  workspacePlan?: WorkspacePlanId | null
  isBillingOwner?: boolean
}

const EVENT = 'hilm:plan-prompt'

/** Opens the upgrade / plan explanation dialog (rendered once by PlanPromptHost). */
export function openPlanPrompt(detail: PlanPromptDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<PlanPromptDetail>(EVENT, { detail }))
}

export function onPlanPrompt(handler: (detail: PlanPromptDetail) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<PlanPromptDetail>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

/** True when a database error carries one of the plan limit codes raised by the entitlement checks. */
export function isPlanLimitError(error: unknown, code: 'workspace_project_limit' | 'workspace_plan_required' | 'workspace_limit_reached') {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? error ?? '')
  return message.includes(code)
}

/** Workspace id of the screen the user is on, used only to choose which message to show. */
export function workspaceIdFromPath(pathname = typeof window === 'undefined' ? '' : window.location.pathname) {
  const match = pathname.match(/^\/workspace\/([0-9a-f-]{36})/i)
  return match ? match[1]! : null
}
