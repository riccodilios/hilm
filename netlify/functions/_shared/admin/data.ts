/** Read models and controls for the admin portal (service connection). */
import type pg from 'pg'

type Db = Pick<pg.Client, 'query'>

const COST = 'coalesce(e.provider_cost_usd, e.estimated_cost_usd)'
const num = (v: unknown) => Number(v ?? 0)

export async function overview(db: Db) {
  const users = await db.query(`
    select count(*)::int as total,
           count(*) filter (where email_confirmed_at is not null)::int as confirmed,
           count(*) filter (where created_at > now() - interval '7 days')::int as new_7d,
           count(*) filter (where created_at > now() - interval '30 days')::int as new_30d,
           count(*) filter (where last_sign_in_at > now() - interval '7 days')::int as signed_in_7d,
           count(*) filter (where banned_until is not null and banned_until > now())::int as locked
    from auth.users where deleted_at is null`)
  const content = await db.query(`
    select (select count(*)::int from public.workspaces) as workspaces,
           (select count(*)::int from public.projects) as personal_projects,
           (select count(*)::int from public.tasks where created_at > now() - interval '7 days')
             + (select count(*)::int from public.workspace_tasks where created_at > now() - interval '7 days') as tasks_7d,
           (select count(*)::int from public.meetings) + (select count(*)::int from public.workspace_meetings) as meetings,
           round(((select coalesce(sum(duration_seconds), 0) from public.meetings)
             + (select coalesce(sum(duration_seconds), 0) from public.workspace_meetings)) / 60.0)::int as meeting_minutes`)
  const ai = await db.query(`
    select round(coalesce(sum(${COST}) filter (where e.created_at > now() - interval '1 day'), 0)::numeric, 4) as cost_24h,
           round(coalesce(sum(${COST}) filter (where e.created_at > now() - interval '30 days'), 0)::numeric, 4) as cost_30d,
           count(*) filter (where e.created_at > now() - interval '1 day')::int as requests_24h
    from public.ai_usage_events e`)
  const email = await db.query(`
    select count(*) filter (where status = 'sent' and updated_at > now() - interval '7 days')::int as sent_7d,
           count(*) filter (where status in ('pending', 'sending'))::int as queued,
           count(*) filter (where status = 'failed' and updated_at > now() - interval '7 days')::int as failed_7d
    from private.email_outbox`)
  const daily = await db.query(`
    with days as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day),
    signups as (select created_at::date as day, count(*)::int as n from auth.users
                where created_at > current_date - 30 group by 1),
    active as (
      select day, count(distinct uid)::int as n from (
        select created_at::date as day, user_id as uid from public.activity_events where created_at > current_date - 30
        union all
        select created_at::date, actor_id from public.workspace_activity_events where created_at > current_date - 30 and actor_id is not null
        union all
        select created_at::date, user_id from public.ai_usage_events where created_at > current_date - 30
      ) x group by day)
    select d.day::text as day, coalesce(s.n, 0) as signups, coalesce(a.n, 0) as active
    from days d left join signups s on s.day = d.day left join active a on a.day = d.day
    order by d.day`)
  const recent = await db.query(`
    select u.id, u.email, u.created_at, u.last_sign_in_at, (u.email_confirmed_at is not null) as confirmed
    from auth.users u where u.deleted_at is null order by u.created_at desc limit 8`)
  return {
    users: users.rows[0],
    content: content.rows[0],
    ai: { cost24h: num(ai.rows[0]?.cost_24h), cost30d: num(ai.rows[0]?.cost_30d), requests24h: num(ai.rows[0]?.requests_24h) },
    email: email.rows[0],
    daily: daily.rows,
    recentSignups: recent.rows,
  }
}

export async function aiCosts(db: Db, days: number) {
  const span = [7, 30, 90, 365].includes(days) ? days : 30
  const window = `e.created_at > now() - make_interval(days => ${span})`
  const totals = await db.query(`
    select round(coalesce(sum(${COST}), 0)::numeric, 4) as cost,
           count(*)::int as requests,
           count(*) filter (where e.status = 'failed')::int as failed,
           coalesce(sum(e.total_tokens), 0)::bigint as tokens,
           round(coalesce(sum(e.audio_ms), 0) / 60000.0, 1) as audio_minutes,
           count(distinct e.user_id)::int as users
    from public.ai_usage_events e where ${window}`)
  const byDay = await db.query(`
    with days as (select generate_series(current_date - ${span - 1}, current_date, interval '1 day')::date as day)
    select d.day::text as day, round(coalesce(sum(${COST}), 0)::numeric, 4) as cost, count(e.id)::int as requests
    from days d left join public.ai_usage_events e on e.created_at::date = d.day
    group by d.day order by d.day`)
  const byFeature = await db.query(`
    select e.request_kind as key, round(sum(${COST})::numeric, 4) as cost, count(*)::int as requests
    from public.ai_usage_events e where ${window} group by 1 order by 2 desc nulls last`)
  const byModel = await db.query(`
    select coalesce(e.model, 'unknown') as key, round(sum(${COST})::numeric, 4) as cost, count(*)::int as requests
    from public.ai_usage_events e where ${window} group by 1 order by 2 desc nulls last limit 12`)
  const topUsers = await db.query(`
    select e.user_id as id, u.email, round(sum(${COST})::numeric, 4) as cost, count(*)::int as requests
    from public.ai_usage_events e left join auth.users u on u.id = e.user_id
    where ${window} group by 1, 2 order by 3 desc nulls last limit 10`)
  const controls = await db.query(
    `select ai_enabled, transcription_enabled, analysis_enabled, max_global_daily_cost_usd, updated_at
     from public.ai_runtime_controls where id = 'global'`,
  )
  return {
    days: span,
    totals: totals.rows[0],
    byDay: byDay.rows,
    byFeature: byFeature.rows,
    byModel: byModel.rows,
    topUsers: topUsers.rows,
    controls: controls.rows[0] ?? null,
  }
}

export async function updateAiControls(
  db: Db,
  patch: { ai_enabled?: boolean; transcription_enabled?: boolean; analysis_enabled?: boolean; max_global_daily_cost_usd?: number | null },
) {
  await db.query(
    `update public.ai_runtime_controls set
       ai_enabled = coalesce($1, ai_enabled),
       transcription_enabled = coalesce($2, transcription_enabled),
       analysis_enabled = coalesce($3, analysis_enabled),
       max_global_daily_cost_usd = case when $4::boolean then $5::numeric else max_global_daily_cost_usd end,
       updated_at = now()
     where id = 'global'`,
    [
      patch.ai_enabled ?? null,
      patch.transcription_enabled ?? null,
      patch.analysis_enabled ?? null,
      'max_global_daily_cost_usd' in patch,
      patch.max_global_daily_cost_usd ?? null,
    ],
  )
}

export async function listUsers(db: Db, q: string, page: number) {
  const search = q.trim().toLowerCase().slice(0, 120)
  const offset = Math.max(0, Math.min(page, 1000)) * 50
  const { rows } = await db.query(
    `select u.id, u.email, u.created_at, u.last_sign_in_at,
            (u.email_confirmed_at is not null) as confirmed,
            (u.banned_until is not null and u.banned_until > now()) as locked,
            nullif(btrim(p.display_name), '') as display_name,
            p.ai_tier_id as tier,
            (select count(*)::int from public.workspaces w where w.owner_id = u.id) as owned_workspaces,
            (select count(*)::int from public.workspace_members m where m.user_id = u.id) as memberships,
            (select round(coalesce(sum(coalesce(e.provider_cost_usd, e.estimated_cost_usd)), 0)::numeric, 4)
               from public.ai_usage_events e where e.user_id = u.id and e.created_at > now() - interval '30 days') as ai_cost_30d,
            exists (select 1 from private.admin_users a where a.user_id = u.id) as is_admin
     from auth.users u
     left join public.profiles p on p.id = u.id
     where u.deleted_at is null
       and ($1 = '' or lower(u.email) like '%' || $1 || '%' or lower(coalesce(p.display_name, '')) like '%' || $1 || '%')
     order by u.created_at desc
     limit 51 offset $2`,
    [search, offset],
  )
  return { users: rows.slice(0, 50), hasMore: rows.length > 50 }
}

/** Changes a user's AI quota tier through private.set_ai_tier (the only path that may). */
export async function setAiTier(db: Db, userId: string, tier: string): Promise<'ok' | 'unknown_tier' | 'unknown_user'> {
  try {
    await db.query(`select private.set_ai_tier($1, $2)`, [userId, tier])
    return 'ok'
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('unknown_tier')) return 'unknown_tier'
    if (message.includes('unknown_user')) return 'unknown_user'
    throw error
  }
}

export async function setLocked(db: Db, userId: string, locked: boolean) {
  const { rowCount } = await db.query(
    `update auth.users set banned_until = $2, updated_at = now()
     where id = $1 and not exists (select 1 from private.admin_users a where a.user_id = $1)`,
    [userId, locked ? '2999-12-31T00:00:00Z' : null],
  )
  if (locked && rowCount) {
    // End existing sessions: refresh tokens stop working; access tokens expire within the hour.
    await db.query(`delete from auth.sessions where user_id = $1`, [userId])
    await db.query(`delete from auth.refresh_tokens where user_id = $1::text`, [userId]).catch(() => undefined)
  }
  return Boolean(rowCount)
}

export async function isAdminUser(db: Db, userId: string) {
  const { rows } = await db.query(`select 1 from private.admin_users where user_id = $1`, [userId])
  return rows.length > 0
}

export async function listNetworks(db: Db) {
  const { rows } = await db.query(`select prefix, label, created_at, last_seen_at from private.admin_allowed_networks order by created_at`)
  return rows
}

export async function removeNetwork(db: Db, prefix: string) {
  const { rowCount } = await db.query(`delete from private.admin_allowed_networks where prefix = $1`, [prefix])
  return Boolean(rowCount)
}

export async function auditLog(db: Db) {
  const { rows } = await db.query(
    `select id::text, at, action, target, network, details from private.admin_audit_log order by at desc limit 200`,
  )
  return rows
}
