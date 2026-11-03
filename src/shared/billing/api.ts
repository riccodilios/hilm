import { supabase } from '@/lib/supabase/client'
import type { PersonalPlanId, PlanId, WorkspacePlanId } from '@/shared/billing/recommend'

/**
 * Plan information for display only. The database decides every entitlement (create_workspace,
 * begin_ai_request, project and storage limits); the app reads plans to explain them.
 */
export type PlanInfo = {
  id: PlanId
  name: string
  scope: 'personal' | 'workspace'
  price_sar_monthly: number
  price_sar_yearly: number | null
  max_workspaces: number | null
  max_projects_per_workspace: number | null
  storage_quota_bytes: number | null
  requests_per_day: number
  requests_per_month: number
  tokens_per_day: number
  tokens_per_month: number
  cost_usd_per_month: number
  member_requests_per_day: number | null
  meeting_minutes_per_month: number
  meeting_max_minutes: number
}

export type MyBilling = {
  personal: PlanInfo
  workspace_subscriptions: Array<{
    id: string
    plan: PlanInfo
    status: string
    usable: boolean
    current_period_end: string | null
    workspaces_used: number
    workspaces: Array<{ id: string; name: string }>
  }>
  can_create_workspace: boolean
  create_block_reason: 'workspace_plan_required' | 'workspace_limit_reached' | null
  pending_requests: Array<{ plan_id: PlanId; created_at: string }>
}

export const billingKeys = {
  all: ['billing'] as const,
  catalog: () => [...billingKeys.all, 'catalog'] as const,
  me: () => [...billingKeys.all, 'me'] as const,
  workspace: (workspaceId: string) => [...billingKeys.all, 'workspace', workspaceId] as const,
}

/** A workspace's own plan, status and pooled usage (workspace_usage_summary). */
export type WorkspaceUsage = {
  ok: boolean
  can_see_costs: boolean
  is_billing_owner?: boolean
  plan?: PlanInfo | null
  subscription?: {
    status: string | null
    effective_status: 'active' | 'grace' | 'restricted' | 'none'
    grace_until: string | null
  }
  ai_pool?: { requests_day: number; requests_month: number; tokens_day: number; tokens_month: number }
  members: number
  projects: number
  tasks_open: number
  tasks_done: number
  meetings: number
  meeting_minutes_month: number
  storage?: { used_bytes: number; quota_bytes: number | null; files: number; attachments_bytes: number; audio_bytes: number }
  ai_month?: { requests: number; tokens: number; meeting_requests: number; cost_usd: number; active_users: number }
}

export async function getWorkspaceUsage(workspaceId: string) {
  const { data, error } = await supabase.rpc('workspace_usage_summary', { p_workspace_id: workspaceId })
  if (error) throw error
  const usage = data as unknown as WorkspaceUsage
  return usage.plan ? { ...usage, plan: numeric(usage.plan as unknown as Record<string, unknown>) } : usage
}

const numeric = (plan: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(plan).map(([key, value]) => [key, typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value]),
  ) as unknown as PlanInfo

export async function getPlanCatalog(): Promise<PlanInfo[]> {
  const { data, error } = await supabase.rpc('plan_catalog')
  if (error) throw error
  return (Array.isArray(data) ? data : []).map((plan) => numeric(plan as Record<string, unknown>))
}

export async function getMyBilling(): Promise<MyBilling> {
  const { data, error } = await supabase.rpc('my_billing')
  if (error) throw error
  const raw = data as unknown as MyBilling
  return {
    ...raw,
    personal: numeric(raw.personal as unknown as Record<string, unknown>),
    workspace_subscriptions: raw.workspace_subscriptions.map((s) => ({ ...s, plan: numeric(s.plan as unknown as Record<string, unknown>) })),
  }
}

export async function requestPlanUpgrade(planId: Exclude<PlanId, 'free'>, workspaceId?: string | null, note?: string) {
  const { data, error } = await supabase.rpc('request_plan_upgrade', {
    p_plan_id: planId,
    p_workspace_id: workspaceId ?? null,
    p_note: note ?? null,
  })
  if (error) throw error
  const result = data as unknown as { ok: boolean; code?: string }
  if (!result.ok) throw new Error(result.code ?? 'request_failed')
  return result
}

/** Best usable workspace plan the caller owns (Team Pro beats Team), for creation prompts. */
export function bestOwnedWorkspacePlan(billing: MyBilling | undefined): WorkspacePlanId | null {
  const usable = (billing?.workspace_subscriptions ?? []).filter((s) => s.usable).map((s) => s.plan.id)
  if (usable.includes('team_pro')) return 'team_pro'
  if (usable.includes('team')) return 'team'
  return null
}

export function personalPlanId(billing: MyBilling | undefined): PersonalPlanId {
  return billing?.personal.id === 'pro' ? 'pro' : 'free'
}

export function sar(amount: number, locale: string) {
  return new Intl.NumberFormat(locale.startsWith('ar') ? 'ar-SA' : 'en-SA', { maximumFractionDigits: 0 }).format(amount)
}
