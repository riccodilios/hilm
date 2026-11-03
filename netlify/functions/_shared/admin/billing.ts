/**
 * Admin console: subscriptions, plan configuration and scope-separated usage. Personal and
 * workspace figures are always reported separately; any combined figure is labelled as such.
 * Runs on the trusted server database connection; every write is audited by the router.
 */
import type pg from 'pg'
import { z } from 'zod'

type Db = Pick<pg.Client, 'query'>

const COST = 'coalesce(e.provider_cost_usd, e.estimated_cost_usd)'
const PERIOD = /^\d{4}-\d{2}$/

/** First day of the requested billing month (UTC), defaulting to the current month. */
function periodStart(period?: string | null) {
  if (period && PERIOD.test(period)) return `${period}-01`
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export async function billingOverview(db: Db, period?: string | null) {
  const start = periodStart(period)
  const plans = await db.query(
    `select id, display_name, scope, price_sar_monthly, price_sar_yearly, max_workspaces, max_projects_per_workspace,
            storage_quota_bytes, requests_per_minute, requests_per_day, requests_per_month, tokens_per_day, tokens_per_month,
            cost_usd_per_day, cost_usd_per_month, max_concurrent, member_requests_per_day, meeting_minutes_per_month,
            meeting_max_minutes, features, enabled, updated_at
     from public.ai_quota_tiers order by sort_order, id`,
  )
  const personal = await db.query(
    `select p.ai_tier_id as plan_id, count(*)::int as accounts
     from public.profiles p join auth.users u on u.id = p.id
     where u.deleted_at is null and coalesce(u.raw_app_meta_data ->> 'hilm_service', '') = ''
     group by 1 order by 1`,
  )
  const workspace = await db.query(
    `select s.plan_id, s.status, count(distinct s.id)::int as subscriptions, count(w.id)::int as workspaces
     from public.workspace_subscriptions s left join public.workspaces w on w.subscription_id = s.id
     group by 1, 2 order by 1, 2`,
  )
  const usage = await db.query(
    `select e.scope,
            count(*) filter (where e.status in ('started', 'completed') and e.request_kind in ('chat', 'daily_log'))::int as requests,
            count(*) filter (where e.status in ('started', 'completed') and e.request_kind like 'meeting_%')::int as meeting_runs,
            coalesce(sum(e.total_tokens) filter (where e.status in ('completed', 'failed') and e.request_kind <> 'meeting_transcribe'), 0)::bigint as tokens,
            round(coalesce(sum(${COST}) filter (where e.status in ('completed', 'failed')), 0)::numeric, 4) as cost_usd,
            count(distinct e.user_id)::int as users,
            count(distinct e.workspace_id)::int as workspaces
     from public.ai_usage_events e
     where e.billing_period = $1::date
     group by 1`,
    [start],
  )
  const storage = await db.query(
    `select case when scope_type = 'workspace' then 'workspace' else 'personal' end as scope,
            coalesce(sum(files_active), 0)::bigint as files, coalesce(sum(bytes_active), 0)::bigint as bytes
     from public.storage_usage group by 1`,
  )
  const requests = await db.query(
    `select r.id, r.plan_id, r.status, r.note, r.created_at, r.workspace_id, u.email, r.user_id
     from public.subscription_requests r left join auth.users u on u.id = r.user_id
     where r.status = 'pending' order by r.created_at limit 100`,
  )
  const byScope = (scope: 'personal' | 'workspace') =>
    usage.rows.find((row) => row.scope === scope) ?? { scope, requests: 0, meeting_runs: 0, tokens: 0, cost_usd: 0, users: 0, workspaces: 0 }
  return {
    period: start.slice(0, 7),
    plans: plans.rows,
    personal: { accounts: personal.rows, usage: byScope('personal') },
    workspace: { subscriptions: workspace.rows, usage: byScope('workspace') },
    storage: storage.rows,
    pendingRequests: requests.rows,
  }
}

export async function listWorkspaceSubscriptions(db: Db, filters: { q?: string | null; plan?: string | null; period?: string | null }) {
  const start = periodStart(filters.period)
  const { rows } = await db.query(
    `select s.id, s.plan_id, s.status, s.provider, s.notes, s.current_period_end, s.cancel_at_period_end, s.created_at,
            s.owner_user_id, u.email as owner_email,
            coalesce(jsonb_agg(jsonb_build_object(
              'id', w.id, 'name', w.name,
              'members', (select count(*) from public.workspace_members m where m.workspace_id = w.id),
              'projects', (select count(*) from public.workspace_projects p where p.workspace_id = w.id and p.status <> 'archived'),
              'ai_requests', (select count(*) from public.ai_usage_events e where e.workspace_id = w.id and e.scope = 'workspace'
                                and e.billing_period = $3::date and e.status in ('started', 'completed') and e.request_kind in ('chat', 'daily_log')),
              'ai_tokens', (select coalesce(sum(e.total_tokens), 0) from public.ai_usage_events e where e.workspace_id = w.id and e.scope = 'workspace'
                              and e.billing_period = $3::date and e.status in ('completed', 'failed') and e.request_kind <> 'meeting_transcribe'),
              'ai_cost_usd', (select round(coalesce(sum(${COST}), 0)::numeric, 4) from public.ai_usage_events e
                                where e.workspace_id = w.id and e.scope = 'workspace' and e.billing_period = $3::date and e.status in ('completed', 'failed')),
              'storage_bytes', (select coalesce(sum(bytes_active), 0) from public.storage_usage su where su.scope_type = 'workspace' and su.scope_id = w.id),
              'effective_status', (select e.effective_status from private.workspace_entitlement(w.id) e)
            ) order by w.created_at) filter (where w.id is not null), '[]'::jsonb) as workspaces
     from public.workspace_subscriptions s
     left join auth.users u on u.id = s.owner_user_id
     left join public.workspaces w on w.subscription_id = s.id
     where ($1 = '' or lower(coalesce(u.email, '')) like '%' || $1 || '%' or exists (
              select 1 from public.workspaces w2 where w2.subscription_id = s.id and lower(w2.name) like '%' || $1 || '%'))
       and ($2 = '' or s.plan_id = $2)
     group by s.id, u.email
     order by s.created_at desc
     limit 200`,
    [(filters.q ?? '').trim().toLowerCase().slice(0, 120), (filters.plan ?? '').trim(), start],
  )
  return { period: start.slice(0, 7), subscriptions: rows }
}

/** One user's usage, personal and per workspace, never merged. */
export async function userUsage(db: Db, userId: string, period?: string | null) {
  const start = periodStart(period)
  const personal = await db.query(
    `select p.ai_tier_id as plan_id,
            count(e.id) filter (where e.status in ('started', 'completed') and e.request_kind in ('chat', 'daily_log'))::int as requests,
            coalesce(sum(e.total_tokens) filter (where e.status in ('completed', 'failed') and e.request_kind <> 'meeting_transcribe'), 0)::bigint as tokens,
            round(coalesce(sum(${COST}) filter (where e.status in ('completed', 'failed')), 0)::numeric, 4) as cost_usd
     from public.profiles p
     left join public.ai_usage_events e on e.user_id = p.id and e.scope = 'personal' and e.billing_period = $2::date
     where p.id = $1 group by p.ai_tier_id`,
    [userId, start],
  )
  const workspace = await db.query(
    `select e.workspace_id, w.name,
            count(*) filter (where e.status in ('started', 'completed') and e.request_kind in ('chat', 'daily_log'))::int as requests,
            coalesce(sum(e.total_tokens) filter (where e.status in ('completed', 'failed') and e.request_kind <> 'meeting_transcribe'), 0)::bigint as tokens,
            round(coalesce(sum(${COST}) filter (where e.status in ('completed', 'failed')), 0)::numeric, 4) as cost_usd
     from public.ai_usage_events e left join public.workspaces w on w.id = e.workspace_id
     where e.user_id = $1 and e.scope = 'workspace' and e.billing_period = $2::date
     group by 1, 2 order by 5 desc`,
    [userId, start],
  )
  return { period: start.slice(0, 7), personal: personal.rows[0] ?? null, workspaceContributions: workspace.rows }
}

const PLAN_IDS = ['free', 'pro', 'team', 'team_pro'] as const
const nullableInt = z.number().int().min(0).max(1_000_000_000).nullable()

export const planUpdateSchema = z
  .object({
    price_sar_monthly: z.number().min(0).max(100000).optional(),
    price_sar_yearly: z.number().min(0).max(1000000).nullable().optional(),
    max_workspaces: nullableInt.optional(),
    max_projects_per_workspace: nullableInt.optional(),
    storage_quota_bytes: z.number().int().min(0).max(10 ** 13).nullable().optional(),
    requests_per_minute: z.number().int().min(0).max(10000).optional(),
    requests_per_day: z.number().int().min(0).max(10_000_000).optional(),
    requests_per_month: z.number().int().min(0).max(100_000_000).optional(),
    tokens_per_day: z.number().int().min(0).max(10 ** 11).optional(),
    tokens_per_month: z.number().int().min(0).max(10 ** 12).optional(),
    cost_usd_per_day: z.number().min(0).max(100000).optional(),
    cost_usd_per_month: z.number().min(0).max(1000000).optional(),
    max_concurrent: z.number().int().min(1).max(100).optional(),
    member_requests_per_day: nullableInt.optional(),
    meeting_minutes_per_month: z.number().int().min(0).max(1_000_000).optional(),
    meeting_max_minutes: z.number().int().min(0).max(10_000).optional(),
    features: z.record(z.string().max(64), z.boolean()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

/** Updates plan configuration. History is untouched: usage events keep their own plan id and cost. */
export async function updatePlan(db: Db, planId: string, patch: z.infer<typeof planUpdateSchema>) {
  if (!(PLAN_IDS as readonly string[]).includes(planId)) return { ok: false as const, error: 'unknown_plan' }
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  if (!entries.length) return { ok: false as const, error: 'nothing_to_change' }
  const before = await db.query(`select * from public.ai_quota_tiers where id = $1`, [planId])
  if (!before.rows.length) return { ok: false as const, error: 'unknown_plan' }
  const sets = entries.map(([key], index) => `${key} = $${index + 2}`)
  const values = entries.map(([key, value]) => (key === 'features' ? JSON.stringify(value) : value))
  await db.query(`update public.ai_quota_tiers set ${sets.join(', ')}, updated_at = now() where id = $1`, [planId, ...values])
  const previous = Object.fromEntries(entries.map(([key]) => [key, before.rows[0][key]]))
  return { ok: true as const, previous }
}

export const subscriptionCreateSchema = z
  .object({
    ownerEmail: z.string().email().max(320),
    planId: z.enum(['team', 'team_pro']),
    status: z.enum(['active', 'trialing', 'comped']).default('active'),
    billingInterval: z.enum(['month', 'year']).default('month'),
    periodEnd: z.string().datetime().nullable().optional(),
    notes: z.string().max(500).optional(),
    requestId: z.string().uuid().optional(),
  })
  .strict()

export async function createWorkspaceSubscription(db: Db, input: z.infer<typeof subscriptionCreateSchema>, adminId: string) {
  const owner = await db.query<{ id: string }>(`select id from auth.users where lower(email) = lower($1) and deleted_at is null`, [input.ownerEmail])
  const ownerId = owner.rows[0]?.id
  if (!ownerId) return { ok: false as const, error: 'unknown_user' }
  const { rows } = await db.query<{ id: string }>(
    `insert into public.workspace_subscriptions (owner_user_id, plan_id, status, billing_interval, current_period_end, provider, notes)
     values ($1, $2, $3, $4, $5, 'manual', $6) returning id`,
    [ownerId, input.planId, input.status, input.billingInterval, input.periodEnd ?? null, input.notes ?? null],
  )
  if (input.requestId) {
    await db.query(
      `update public.subscription_requests set status = 'approved', handled_by = $2, handled_at = now() where id = $1 and status = 'pending'`,
      [input.requestId, adminId],
    )
  }
  return { ok: true as const, id: rows[0]!.id, ownerId }
}

export const subscriptionUpdateSchema = z
  .object({
    planId: z.enum(['team', 'team_pro']).optional(),
    status: z.enum(['active', 'trialing', 'comped', 'past_due', 'canceled', 'expired']).optional(),
    periodEnd: z.string().datetime().nullable().optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
    graceDays: z.number().int().min(0).max(90).optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict()

export async function updateWorkspaceSubscription(db: Db, id: string, patch: z.infer<typeof subscriptionUpdateSchema>) {
  const before = await db.query(`select plan_id, status, current_period_end, cancel_at_period_end, grace_days, notes from public.workspace_subscriptions where id = $1`, [id])
  if (!before.rows.length) return { ok: false as const, error: 'not_found' }
  const map: Record<string, string> = {
    planId: 'plan_id',
    status: 'status',
    periodEnd: 'current_period_end',
    cancelAtPeriodEnd: 'cancel_at_period_end',
    graceDays: 'grace_days',
    notes: 'notes',
  }
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  if (!entries.length) return { ok: false as const, error: 'nothing_to_change' }
  const sets = entries.map(([key], index) => `${map[key]} = $${index + 2}`)
  await db.query(`update public.workspace_subscriptions set ${sets.join(', ')} where id = $1`, [id, ...entries.map(([, value]) => value)])
  return { ok: true as const, previous: before.rows[0] }
}

/** Billing ownership moves only through this audited admin path, never with workspace roles. */
export async function transferBillingOwner(db: Db, id: string, newOwnerEmail: string) {
  const owner = await db.query<{ id: string }>(`select id from auth.users where lower(email) = lower($1) and deleted_at is null`, [newOwnerEmail])
  const ownerId = owner.rows[0]?.id
  if (!ownerId) return { ok: false as const, error: 'unknown_user' }
  const before = await db.query<{ owner_user_id: string }>(`select owner_user_id from public.workspace_subscriptions where id = $1`, [id])
  if (!before.rows.length) return { ok: false as const, error: 'not_found' }
  await db.query(`update public.workspace_subscriptions set owner_user_id = $2 where id = $1`, [id, ownerId])
  return { ok: true as const, previousOwner: before.rows[0]!.owner_user_id, ownerId }
}

/** Attaches an existing workspace to a subscription (capacity is checked). */
export async function attachWorkspace(db: Db, subscriptionId: string, workspaceId: string) {
  const capacity = await db.query<{ used: number; max: number | null }>(
    `select (select count(*)::int from public.workspaces w where w.subscription_id = s.id) as used, t.max_workspaces as max
     from public.workspace_subscriptions s join public.ai_quota_tiers t on t.id = s.plan_id where s.id = $1`,
    [subscriptionId],
  )
  const row = capacity.rows[0]
  if (!row) return { ok: false as const, error: 'not_found' }
  if (row.max !== null && row.used >= row.max) return { ok: false as const, error: 'no_capacity' }
  const result = await db.query<{ ok: boolean }>(`select private.attach_workspace_subscription($1, $2) as ok`, [workspaceId, subscriptionId])
  return result.rows[0]?.ok ? { ok: true as const } : { ok: false as const, error: 'workspace_not_found' }
}

export async function setRequestStatus(db: Db, id: string, status: 'approved' | 'declined', adminId: string) {
  const { rowCount } = await db.query(
    `update public.subscription_requests set status = $2, handled_by = $3, handled_at = now() where id = $1 and status = 'pending'`,
    [id, status, adminId],
  )
  return Boolean(rowCount)
}
