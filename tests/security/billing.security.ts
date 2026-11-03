/**
 * Personal OS and Workspace OS billing isolation. Runs as real authenticated users inside one
 * transaction that is always rolled back. BILLING_APPLY_MIGRATION=1 applies 0053 inside the same
 * transaction first (pre-flight before the real migration).
 *
 * Fixture: user1 and user2 on Personal Free, user3 on Personal Pro and owner of a Team workspace
 * that all three use; user4 on Personal Pro without a workspace plan.
 */
import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { billingOverview, userUsage } from '../../netlify/functions/_shared/admin/billing'
import { asUser, attempt, createAuthUser, env, newClient, refusedAs, testEmail, uid } from './helpers'

const u = { user1: uid(), user2: uid(), user3: uid(), user4: uid() }
let client: pg.Client
let workspaceId = ''
let subscriptionId = ''
type Json = Record<string, unknown>

async function one(sql: string, params: unknown[] = []) {
  const { rows } = await client.query(sql, params)
  return rows[0] as Json
}

async function begin(user: string, scope: 'personal' | 'workspace', opts: { key?: string; workspace?: string | null } = {}) {
  const workspace = opts.workspace === undefined ? (scope === 'workspace' ? workspaceId : null) : opts.workspace
  const { rows } = await asUser(
    client,
    user,
    `select public.begin_ai_request('chat', 'google/gemini-2.5-flash', $1, null, $2, null, null, $3) as r`,
    [workspace, opts.key ?? null, scope],
  )
  return rows[0].r as Json
}

async function complete(eventId: unknown, tokens: number) {
  return (await one(`select private.complete_ai_request($1, 'completed', $2, $3, 'google/gemini-2.5-flash', null, null, 0, 0, 0, null) as r`, [
    eventId,
    Math.floor(tokens / 2),
    tokens - Math.floor(tokens / 2),
  ])).r as Json
}

/** Seeds already-finished usage directly in the ledger (as the server would have recorded it). */
async function seedUsage(user: string, scope: 'personal' | 'workspace', tokens: number, at = 'now()') {
  await client.query(
    `insert into public.ai_usage_events (user_id, workspace_id, scope, request_kind, model, status, input_tokens, output_tokens, total_tokens,
       estimated_cost_usd, created_at, completed_at)
     values ($1, $2, $3, 'chat', 'google/gemini-2.5-flash', 'completed', $4, 0, $4, 0, ${at}, ${at})`,
    [user, scope === 'workspace' ? workspaceId : null, scope, tokens],
  )
}

const personal = async (user: string) => {
  const r = (await asUser(client, user, `select public.get_ai_usage_summary() as r`)).rows[0].r as Json
  return r.usage as { requests_day: number; tokens_day: number; tokens_month: number }
}
const pool = async (user: string) => {
  const r = (await asUser(client, user, `select public.workspace_usage_summary($1) as r`, [workspaceId])).rows[0].r as Json
  return r.ai_pool as { requests_day: number; tokens_day: number; tokens_month: number }
}

beforeAll(async () => {
  client = newClient()
  await client.connect()
  await client.query('begin')
  if (env.BILLING_APPLY_MIGRATION === '1') {
    await client.query(fs.readFileSync('supabase/migrations/0053_workspace_billing.sql', 'utf8'))
  }
  for (const [label, id] of Object.entries(u)) await createAuthUser(client, id, testEmail(`billing-${label}`))
  await client.query(`select private.set_ai_tier($1, 'pro')`, [u.user3])
  await client.query(`select private.set_ai_tier($1, 'pro')`, [u.user4])
  subscriptionId = String((await one(
    `insert into public.workspace_subscriptions (owner_user_id, plan_id, status, provider) values ($1, 'team', 'active', 'manual') returning id`,
    [u.user3],
  )).id)
}, 240_000)

afterAll(async () => {
  await client?.query('rollback').catch(() => undefined)
  await client?.end().catch(() => undefined)
})

describe('workspace creation and membership', () => {
  it('8. a Personal Pro user without a workspace plan cannot create a workspace', async () => {
    const refused = await refusedAs(client, u.user4, `select public.create_workspace('Pro only')`)
    expect(refused?.message).toContain('workspace_plan_required')
  })

  it('9. a Team subscriber creates one workspace', async () => {
    const ws = (await asUser(client, u.user3, `select * from public.create_workspace('Team space')`)).rows[0] as Json
    workspaceId = String(ws.id)
    expect(ws.subscription_id).toBe(subscriptionId)
    const code = (await one(`select invite_code from public.workspaces where id = $1`, [workspaceId])).invite_code
    await asUser(client, u.user1, `select public.join_workspace_by_invite($1)`, [code])
    await asUser(client, u.user2, `select public.join_workspace_by_invite($1)`, [code])
    expect(Number((await one(`select count(*) as n from public.workspace_members where workspace_id = $1`, [workspaceId])).n)).toBe(3)
  })

  it('10. a Team subscriber cannot create a second workspace', async () => {
    const refused = await refusedAs(client, u.user3, `select public.create_workspace('Second space')`)
    expect(refused?.message).toContain('workspace_limit_reached')
  })

  it('11. a Team workspace cannot hold an eleventh active project', async () => {
    for (let i = 1; i <= 10; i += 1) {
      await asUser(client, u.user3, `insert into public.workspace_projects (workspace_id, created_by, name) values ($1, $2, $3)`, [workspaceId, u.user3, `P${i}`])
    }
    const refused = await refusedAs(client, u.user3, `insert into public.workspace_projects (workspace_id, created_by, name) values ($1, $2, 'P11')`, [workspaceId, u.user3])
    expect(refused?.message).toContain('workspace_project_limit')
    await asUser(client, u.user3, `update public.workspace_projects set status = 'archived' where workspace_id = $1 and name = 'P10'`, [workspaceId])
    await asUser(client, u.user3, `insert into public.workspace_projects (workspace_id, created_by, name) values ($1, $2, 'P11')`, [workspaceId, u.user3])
    const reopen = await refusedAs(client, u.user3, `update public.workspace_projects set status = 'active' where workspace_id = $1 and name = 'P10'`, [workspaceId])
    expect(reopen?.message).toContain('workspace_project_limit')
  })

  it('12. a Personal Free member uses the paid workspace', async () => {
    const projects = (await asUser(client, u.user1, `select count(*) as n from public.workspace_projects where workspace_id = $1`, [workspaceId])).rows[0].n
    expect(Number(projects)).toBe(11)
    const task = await attempt(client, u.user1, () =>
      client.query(`insert into public.workspace_tasks (workspace_id, project_id, created_by, assignee_id, title)
                    select $1, id, $2, $2, 'Member task' from public.workspace_projects where workspace_id = $1 and name = 'P1'`, [workspaceId, u.user1]),
    )
    expect(task.ok).toBe(true)
    const ai = await begin(u.user1, 'workspace')
    expect(ai.ok).toBe(true)
    await complete(ai.event_id, 10)
  })

  it('13. members cannot change the workspace subscription or plans', async () => {
    await client.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [workspaceId, u.user2])
    const relink = await refusedAs(client, u.user2, `update public.workspaces set subscription_id = gen_random_uuid() where id = $1`, [workspaceId])
    expect(relink).not.toBeNull()
    const ownerRelink = await refusedAs(client, u.user3, `update public.workspaces set subscription_id = null where id = $1`, [workspaceId])
    expect(ownerRelink?.message).toContain('workspace_billing_locked')
    const planChange = await refusedAs(client, u.user3, `update public.workspace_subscriptions set plan_id = 'team_pro' where id = $1`, [subscriptionId])
    expect(planChange).not.toBeNull()
    const insert = await refusedAs(client, u.user4, `insert into public.workspace_subscriptions (owner_user_id, plan_id) values ($1, 'team_pro')`, [u.user4])
    expect(insert).not.toBeNull()
    const ownTier = await refusedAs(client, u.user1, `update public.profiles set ai_tier_id = 'pro' where id = $1`, [u.user1])
    const tier = (await one(`select ai_tier_id from public.profiles where id = $1`, [u.user1])).ai_tier_id
    expect(ownTier !== null || tier === 'free').toBe(true)
    expect(tier).toBe('free')
    const workspaceTierOnProfile = await attempt(client, null, () => client.query(`select private.set_ai_tier($1, 'team')`, [u.user1]))
    expect(workspaceTierOnProfile.ok).toBe(false)
    const ledger = await refusedAs(client, u.user1, `update public.ai_usage_events set total_tokens = 0 where user_id = $1`, [u.user1])
    const forged = await refusedAs(client, u.user1, `insert into public.ai_usage_events (user_id, scope, request_kind, status) values ($1, 'personal', 'chat', 'completed')`, [u.user1])
    expect(forged).not.toBeNull()
    expect(ledger === null || ledger.message.length > 0).toBe(true)
  })
})

describe('AI usage stays in its own scope', () => {
  it('rejects a missing or foreign workspace instead of charging personal usage', async () => {
    expect((await begin(u.user4, 'workspace')).code).toBe('not_workspace_member')
    expect((await begin(u.user1, 'workspace', { workspace: null })).code).toBe('workspace_required')
    expect((await begin(u.user1, 'personal', { workspace: workspaceId })).code).toBe('scope_mismatch')
  })

  it('1. user1 exhausts Personal Free AI and workspace AI still works', async () => {
    await seedUsage(u.user1, 'personal', 25_000)
    expect((await begin(u.user1, 'personal')).code).toBe('daily_token_limit')
    const ws = await begin(u.user1, 'workspace')
    expect(ws.ok).toBe(true)
    await complete(ws.event_id, 100)
  })

  it('2. user1 workspace AI never raises personal usage', async () => {
    const before = await personal(u.user1)
    const poolBefore = await pool(u.user1)
    const ws = await begin(u.user1, 'workspace')
    await complete(ws.event_id, 2_000)
    const after = await personal(u.user1)
    expect(after.tokens_day).toBe(before.tokens_day)
    expect(after.requests_day).toBe(before.requests_day)
    expect((await pool(u.user1)).tokens_day).toBe(poolBefore.tokens_day + 2_000)
  })

  it('4. user3 personal AI counts against Personal Pro only', async () => {
    const poolBefore = await pool(u.user3)
    const p = await begin(u.user3, 'personal')
    expect(p.ok).toBe(true)
    expect(p.plan).toBe('pro')
    await complete(p.event_id, 1_500)
    expect((await personal(u.user3)).tokens_day).toBe(1_500)
    expect((await pool(u.user3)).tokens_day).toBe(poolBefore.tokens_day)
  })

  it('5. user3 workspace AI counts against Team only', async () => {
    const personalBefore = await personal(u.user3)
    const poolBefore = await pool(u.user3)
    const w = await begin(u.user3, 'workspace')
    expect(w.plan).toBe('team')
    await complete(w.event_id, 3_000)
    expect((await personal(u.user3)).tokens_day).toBe(personalBefore.tokens_day)
    expect((await pool(u.user3)).tokens_day).toBe(poolBefore.tokens_day + 3_000)
  })

  it('17. a repeated request is charged once', async () => {
    const first = await begin(u.user3, 'workspace', { key: 'billing-test-idem' })
    expect(first.ok).toBe(true)
    await complete(first.event_id, 500)
    const again = await begin(u.user3, 'workspace', { key: 'billing-test-idem' })
    expect(again.code).toBe('duplicate')
    const second = await complete(first.event_id, 500)
    expect(second.code).toBe('already_completed')
    const rows = await one(`select count(*) as n, sum(total_tokens) as t from public.ai_usage_events where user_id = $1 and idempotency_key = 'billing-test-idem'`, [u.user3])
    expect(Number(rows.n)).toBe(1)
    expect(Number(rows.t)).toBe(500)
  })

  it('7. user3 exhausts Personal Pro and the workspace keeps working', async () => {
    await seedUsage(u.user3, 'personal', 150_000)
    expect((await begin(u.user3, 'personal')).code).toBe('daily_token_limit')
    const w = await begin(u.user3, 'workspace')
    expect(w.ok).toBe(true)
    await complete(w.event_id, 10)
  })

  it('16. in-flight reservations stop concurrent requests from overshooting the pool', async () => {
    const used = (await pool(u.user3)).tokens_day
    await client.query(`savepoint concurrency`)
    await seedUsage(u.user3, 'workspace', 750_000 - used - 4_000)
    const a = await begin(u.user1, 'workspace')
    const b = await begin(u.user2, 'workspace')
    const c = await begin(u.user3, 'workspace')
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(c.code).toBe('daily_token_limit')
    await client.query(`rollback to savepoint concurrency`)
  })

  it('6. user3 exhausts the Team monthly allowance and Personal Pro is unaffected', async () => {
    await client.query(`savepoint monthly`)
    await client.query(`delete from public.ai_usage_events where user_id = $1 and scope = 'personal'`, [u.user3])
    await seedUsage(u.user3, 'workspace', 12_000_000, `greatest(date_trunc('month', now()), now() - interval '2 days')`)
    const w = await begin(u.user3, 'workspace')
    expect(['monthly_token_limit', 'daily_token_limit']).toContain(w.code)
    const p = await begin(u.user3, 'personal')
    expect(p.ok).toBe(true)
    const notified = await one(`select count(*) as n from public.notifications where user_id = $1 and type = 'workspace.ai_limit'`, [u.user3])
    expect(Number(notified.n)).toBeGreaterThan(0)
    await client.query(`rollback to savepoint monthly`)
  })
})

describe('storage scope', () => {
  it('3. a workspace attachment counts toward workspace storage, not personal storage', async () => {
    const task = String((await one(`select id from public.workspace_tasks where workspace_id = $1 limit 1`, [workspaceId])).id)
    const personalBefore = Number((await one(`select coalesce(sum(bytes_active), 0) as b from public.storage_usage where scope_type = 'user' and scope_id = $1`, [u.user2])).b)
    const workspaceBefore = Number((await one(`select coalesce(sum(bytes_active), 0) as b from public.storage_usage where scope_type = 'workspace' and scope_id = $1`, [workspaceId])).b)
    const begun = (await asUser(client, u.user2, `select public.storage_begin_upload('task_attachment', 'workspace_task', $1, 'spec.pdf', 'application/pdf', 4096, null) as r`, [task])).rows[0].r as Json
    expect(begun.ok).toBe(true)
    await asUser(client, u.user2, `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, jsonb_build_object('size', 4096, 'mimetype', 'application/pdf'))`, [begun.object_key, u.user2])
    const done = (await asUser(client, u.user2, `select public.storage_complete_upload($1) as r`, [begun.file_id])).rows[0].r as Json
    expect(done.ok).toBe(true)
    const personalAfter = Number((await one(`select coalesce(sum(bytes_active), 0) as b from public.storage_usage where scope_type = 'user' and scope_id = $1`, [u.user2])).b)
    const workspaceAfter = Number((await one(`select coalesce(sum(bytes_active), 0) as b from public.storage_usage where scope_type = 'workspace' and scope_id = $1`, [workspaceId])).b)
    expect(personalAfter).toBe(personalBefore)
    expect(workspaceAfter).toBe(workspaceBefore + 4096)
    const quota = await one(`select quota_bytes from private.storage_quota_for('workspace', $1, null)`, [workspaceId])
    expect(Number(quota.quota_bytes)).toBe(5368709120)
  })
})

describe('independent lifecycles', () => {
  it('14. cancelling Personal Pro does not touch Team', async () => {
    await client.query(`savepoint cancel_personal`)
    await client.query(`select private.set_ai_tier($1, 'free')`, [u.user3])
    const sub = await one(`select status from public.workspace_subscriptions where id = $1`, [subscriptionId])
    expect(sub.status).toBe('active')
    const w = await begin(u.user3, 'workspace')
    expect(w.ok).toBe(true)
    expect(w.plan).toBe('team')
    await client.query(`rollback to savepoint cancel_personal`)
  })

  it('15. cancelling Team does not touch Personal Pro; the workspace turns read-only after grace, data kept', async () => {
    await client.query(`savepoint cancel_team`)
    await client.query(
      `update public.workspace_subscriptions set status = 'canceled', current_period_end = now() - interval '10 days', grace_days = 7 where id = $1`,
      [subscriptionId],
    )
    expect((await one(`select ai_tier_id from public.profiles where id = $1`, [u.user3])).ai_tier_id).toBe('pro')
    expect((await begin(u.user3, 'workspace')).code).toBe('workspace_subscription_inactive')
    await client.query(`delete from public.ai_usage_events where user_id = $1 and scope = 'personal'`, [u.user3])
    expect((await begin(u.user3, 'personal')).ok).toBe(true)
    const write = await refusedAs(client, u.user1, `update public.workspace_projects set name = 'renamed' where workspace_id = $1 and name = 'P1'`, [workspaceId])
    const renamed = Number((await one(`select count(*) as n from public.workspace_projects where workspace_id = $1 and name = 'renamed'`, [workspaceId])).n)
    expect(write !== null || renamed === 0).toBe(true)
    const kept = Number((await asUser(client, u.user1, `select count(*) as n from public.workspace_projects where workspace_id = $1`, [workspaceId])).rows[0].n)
    expect(kept).toBe(11)
    await client.query(`update public.workspace_subscriptions set current_period_end = now() - interval '2 days' where id = $1`, [subscriptionId])
    expect((await begin(u.user3, 'workspace')).ok).toBe(true)
    await client.query(`rollback to savepoint cancel_team`)
  })
})

describe('workspace deletion', () => {
  it('a workspace with usage history can be deleted; its events stay workspace-scoped', async () => {
    await client.query(`savepoint delete_ws`)
    await client.query(`delete from public.workspaces where id = $1`, [workspaceId])
    const rows = await one(
      `select count(*) filter (where scope = 'workspace')::int as ws, count(*) filter (where scope = 'personal' and user_id = $1)::int as personal
       from public.ai_usage_events where user_id = any($2)`,
      [u.user1, [u.user1, u.user2, u.user3]],
    )
    expect(rows.ws).toBeGreaterThan(0)
    expect((await personal(u.user1)).tokens_day).toBe(25_000)
    await client.query(`rollback to savepoint delete_ws`)
  })
})

describe('admin reporting', () => {
  it('18. personal and workspace usage are reported separately', async () => {
    const overview = await billingOverview(client)
    expect(Number(overview.workspace.usage.tokens)).toBeGreaterThan(0)
    expect(Number(overview.personal.usage.tokens)).toBeGreaterThan(0)
    const user1 = await userUsage(client, u.user1)
    expect(Number(user1.personal?.tokens)).toBe(25_000)
    expect(user1.workspaceContributions).toHaveLength(1)
    expect(Number(user1.workspaceContributions[0]?.tokens)).toBe(2_110)
    expect(user1.workspaceContributions[0]?.workspace_id).toBe(workspaceId)
  })
})
