import { useQuery } from '@tanstack/react-query'
import { billingKeys, getMyBilling } from '@/shared/billing/api'
import { openPlanPrompt } from '@/shared/billing/plan-prompt'

const PLAN_ERRORS = ['workspace_plan_required', 'workspace_limit_reached']

/**
 * Workspace creation needs a Team or Team Pro plan with a free slot. The database enforces it in
 * create_workspace; this only decides whether to show the form or the plan explanation first.
 */
export function useWorkspaceCreateGate() {
  const billing = useQuery({ queryKey: billingKeys.me(), queryFn: getMyBilling, staleTime: 30_000 })

  /** Runs `open` when creation is allowed, otherwise shows the matching plan prompt. */
  const guard = (open: () => void) => {
    if (billing.data && !billing.data.can_create_workspace) {
      openPlanPrompt({ reason: 'workspace_create' })
      return
    }
    open()
  }

  /** True when a create error was a plan limit (and the plan prompt was shown). */
  const handleError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? '')
    if (!PLAN_ERRORS.some((code) => message.includes(code))) return false
    void billing.refetch()
    openPlanPrompt({ reason: 'workspace_create' })
    return true
  }

  return { guard, handleError, billing }
}
