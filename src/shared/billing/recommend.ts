/**
 * Which plan an upgrade prompt may offer. Personal limits only ever lead to Personal OS plans;
 * workspace limits only ever lead to workspace plans (and only for the person who pays for them).
 */
export type PersonalPlanId = 'free' | 'pro'
export type WorkspacePlanId = 'team' | 'team_pro'
export type PlanId = PersonalPlanId | WorkspacePlanId

export type PlanPromptReason =
  | 'personal_upgrade'
  | 'personal_ai_limit'
  | 'workspace_create'
  | 'workspace_project_limit'
  | 'workspace_ai_limit'
  | 'workspace_inactive'

export type PlanRecommendation = {
  scope: 'personal' | 'workspace'
  /** Plan the user is on in the scope that hit the limit. */
  current: PlanId | null
  /** Plan to offer, or null when no purchase helps (the prompt only explains). */
  target: PlanId | null
  /** What the prompt explains when there is nothing to buy. */
  note: 'already_pro' | 'no_topups' | 'max_plan' | 'owner_notified' | 'ask_owner' | 'renew' | null
}

export function recommendPlan(input: {
  reason: PlanPromptReason
  personalPlan: PersonalPlanId
  /** The workspace's plan (for workspace reasons) or the caller's best usable plan (for creation). */
  workspacePlan?: WorkspacePlanId | null
  /** The caller pays for the workspace's subscription. */
  isBillingOwner?: boolean
}): PlanRecommendation {
  const { reason, personalPlan, workspacePlan = null, isBillingOwner = false } = input
  switch (reason) {
    case 'personal_upgrade':
      return personalPlan === 'free'
        ? { scope: 'personal', current: 'free', target: 'pro', note: null }
        : { scope: 'personal', current: 'pro', target: null, note: 'already_pro' }
    case 'personal_ai_limit':
      return personalPlan === 'free'
        ? { scope: 'personal', current: 'free', target: 'pro', note: null }
        : { scope: 'personal', current: 'pro', target: null, note: 'no_topups' }
    case 'workspace_create':
      if (!workspacePlan) return { scope: 'workspace', current: null, target: 'team', note: null }
      if (workspacePlan === 'team') return { scope: 'workspace', current: 'team', target: 'team_pro', note: null }
      return { scope: 'workspace', current: 'team_pro', target: null, note: 'max_plan' }
    case 'workspace_project_limit':
      // Both plans allow 10 projects per workspace; Team Pro adds workspaces, not projects.
      if (!isBillingOwner) return { scope: 'workspace', current: workspacePlan, target: null, note: 'ask_owner' }
      return workspacePlan === 'team'
        ? { scope: 'workspace', current: 'team', target: 'team_pro', note: null }
        : { scope: 'workspace', current: workspacePlan, target: null, note: 'max_plan' }
    case 'workspace_ai_limit':
      if (isBillingOwner && workspacePlan === 'team') return { scope: 'workspace', current: 'team', target: 'team_pro', note: 'owner_notified' }
      return { scope: 'workspace', current: workspacePlan, target: null, note: 'owner_notified' }
    case 'workspace_inactive':
      return isBillingOwner && workspacePlan
        ? { scope: 'workspace', current: workspacePlan, target: workspacePlan, note: 'renew' }
        : { scope: 'workspace', current: workspacePlan, target: null, note: 'ask_owner' }
  }
}

const PERSONAL_AI_CODES = new Set([
  'daily_request_limit',
  'monthly_request_limit',
  'daily_token_limit',
  'monthly_token_limit',
  'daily_cost_limit',
  'monthly_cost_limit',
])

/** Maps an AI guard rejection to the prompt it should open, if any. */
export function promptForAiCode(code: string | undefined, scope: 'personal' | 'workspace' | undefined): PlanPromptReason | null {
  if (!code) return null
  if (code === 'workspace_subscription_inactive') return 'workspace_inactive'
  if (!PERSONAL_AI_CODES.has(code)) return null
  return scope === 'workspace' ? 'workspace_ai_limit' : 'personal_ai_limit'
}
