/**
 * Infrastructure metrics collection. Runs on the scheduler (hourly) or on demand from the admin
 * console and writes private.ops_metric_snapshots, which the console reads; pages never scan
 * storage or call providers themselves.
 *
 * Quality classes:
 *  provider_live   – read directly from the provider's own system at collection time (Postgres
 *                    catalogs, storage.objects, OpenRouter key endpoint)
 *  provider_synced – provider usage API that is itself updated periodically (Netlify usage)
 *  app_calculated  – computed by Hilm from its own records (AI ledger, email outbox, registry)
 *  estimated       – derived with stated assumptions
 *  manual          – entered by an admin
 *  unavailable     – no source exists; never filled with a guess
 */
import type { Queryable } from '../storage/lifecycle.ts'

export type Quality = 'provider_live' | 'provider_synced' | 'app_calculated' | 'estimated' | 'manual' | 'unavailable'

export type Metric = {
  metric: string
  scope?: string
  value: number | null
  unit: string
  source: string
  quality: Quality
  details?: unknown
}

const n = (v: unknown) => (v == null ? null : Number(v))

export async function collectDatabaseMetrics(db: Queryable): Promise<Metric[]> {
  const size = (
    await db.query<{ bytes: string; conns: string; max_conns: string }>(
      `select pg_database_size(current_database()) as bytes,
              (select count(*) from pg_stat_activity) as conns,
              current_setting('max_connections') as max_conns`,
    )
  ).rows[0]
  const tables = (
    await db.query<{ name: string; bytes: string; rows: string }>(
      `select n.nspname || '.' || c.relname as name, pg_total_relation_size(c.oid) as bytes, greatest(c.reltuples, 0)::bigint as rows
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname in ('public', 'private', 'auth', 'storage')
       order by pg_total_relation_size(c.oid) desc limit 15`,
    )
  ).rows
  const source = 'Postgres catalog (pg_database_size, pg_stat_activity)'
  return [
    { metric: 'supabase.db_size_bytes', value: n(size?.bytes), unit: 'bytes', source, quality: 'provider_live' },
    {
      metric: 'supabase.db_connections',
      value: n(size?.conns),
      unit: 'connections',
      source,
      quality: 'provider_live',
      details: { max_connections: n(size?.max_conns) },
    },
    {
      metric: 'supabase.db_largest_tables',
      value: tables.reduce((sum, t) => sum + Number(t.bytes), 0),
      unit: 'bytes',
      source: 'pg_total_relation_size',
      quality: 'provider_live',
      details: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes), rows: Number(t.rows) })),
    },
  ]
}

export async function collectStorageMetrics(db: Queryable): Promise<Metric[]> {
  const buckets = (
    await db.query<{ bucket: string; files: string; bytes: string }>(
      `select bucket_id as bucket, count(*) as files, coalesce(sum((metadata ->> 'size')::bigint), 0) as bytes
       from storage.objects group by bucket_id order by 3 desc`,
    )
  ).rows
  const total = buckets.reduce((sum, b) => sum + Number(b.bytes), 0)
  const metrics: Metric[] = [
    {
      metric: 'supabase.storage_bytes',
      value: total,
      unit: 'bytes',
      source: 'storage.objects metadata',
      quality: 'provider_live',
      details: buckets.map((b) => ({ bucket: b.bucket, files: Number(b.files), bytes: Number(b.bytes) })),
    },
  ]

  const report = (await db.query<{ r: Record<string, unknown> }>(`select private.storage_inventory_report() as r`)).rows[0]?.r ?? {}
  const queue = (report.queue ?? {}) as { pending?: number; failed?: number; oldest_pending_hours?: number }
  metrics.push(
    { metric: 'storage.inventory', value: total, unit: 'bytes', source: 'storage registry', quality: 'app_calculated', details: report },
    { metric: 'storage.queue_pending', value: n(queue.pending) ?? 0, unit: 'files', source: 'private.storage_object_deletions', quality: 'app_calculated' },
    { metric: 'storage.queue_failed', value: n(queue.failed) ?? 0, unit: 'files', source: 'private.storage_object_deletions', quality: 'app_calculated' },
    {
      metric: 'storage.queue_oldest_hours',
      value: Math.round((n(queue.oldest_pending_hours) ?? 0) * 10) / 10,
      unit: 'hours',
      source: 'private.storage_object_deletions',
      quality: 'app_calculated',
    },
  )

  const uploads = (
    await db.query<{ started: string; failed: string }>(
      `select count(*) filter (where declared_size_bytes is not null) as started,
              count(*) filter (where declared_size_bytes is not null and status in ('failed', 'abandoned')) as failed
       from public.storage_files where created_at > now() - interval '24 hours'`,
    )
  ).rows[0]
  const started = Number(uploads?.started ?? 0)
  metrics.push({
    metric: 'storage.upload_failure_rate',
    value: started ? (Number(uploads?.failed ?? 0) / started) * 100 : 0,
    unit: 'percent',
    source: 'storage registry (last 24 h)',
    quality: 'app_calculated',
    details: { started, failed: Number(uploads?.failed ?? 0) },
  })

  const growth = (
    await db.query<{ last_day: string; prior_week: string }>(
      `select coalesce(sum(size_bytes) filter (where coalesce(activated_at, created_at) > now() - interval '1 day'), 0) as last_day,
              coalesce(sum(size_bytes) filter (where coalesce(activated_at, created_at) between now() - interval '8 days' and now() - interval '1 day'), 0) as prior_week
       from public.storage_files where coalesce(activated_at, created_at) > now() - interval '8 days'`,
    )
  ).rows[0]
  const lastDay = Number(growth?.last_day ?? 0)
  const priorAvg = Number(growth?.prior_week ?? 0) / 7
  metrics.push(
    {
      metric: 'storage.growth_ratio',
      value: priorAvg > 0 ? lastDay / priorAvg : null,
      unit: 'ratio',
      source: 'storage registry',
      quality: 'app_calculated',
      details: { last_day_bytes: lastDay, prior_daily_avg_bytes: priorAvg },
    },
    { metric: 'storage.added_last_day_bytes', value: lastDay, unit: 'bytes', source: 'storage registry', quality: 'app_calculated' },
  )

  const top = (
    await db.query<{ id: string; name: string | null; bytes: string; files: string }>(
      `select u.scope_id as id, w.name, sum(u.bytes_active) as bytes, sum(u.files_active) as files
       from public.storage_usage u left join public.workspaces w on w.id = u.scope_id
       where u.scope_type = 'workspace' group by 1, 2 order by 3 desc limit 10`,
    )
  ).rows
  metrics.push({
    metric: 'storage.top_workspaces',
    value: top.length,
    unit: 'workspaces',
    source: 'public.storage_usage',
    quality: 'app_calculated',
    details: top.map((t) => ({ id: t.id, name: t.name, bytes: Number(t.bytes), files: Number(t.files) })),
  })

  const audio = (
    await db.query<{ bytes: string | null; ms: string | null }>(
      `select sum(byte_size) as bytes, sum(duration_ms) as ms from (
         select byte_size, duration_ms from public.meeting_audio_segments where byte_size > 0 and duration_ms > 0
         union all
         select byte_size, duration_ms from public.workspace_meeting_audio_segments where byte_size > 0 and duration_ms > 0
       ) s`,
    )
  ).rows[0]
  const ms = Number(audio?.ms ?? 0)
  metrics.push({
    metric: 'storage.audio_bytes_per_hour',
    value: ms > 0 ? (Number(audio?.bytes ?? 0) / ms) * 3_600_000 : null,
    unit: 'bytes',
    source: 'meeting audio segments (all recorded)',
    quality: 'app_calculated',
  })

  const lastRun = (
    await db.query<{ status: string; mode: string; started_at: string; stats: Record<string, unknown> }>(
      `select status, mode, started_at, stats from private.storage_lifecycle_runs order by started_at desc limit 1`,
    )
  ).rows[0]
  metrics.push({
    metric: 'storage.circuit_breaker',
    value: lastRun?.stats?.circuit_breaker ? 1 : 0,
    unit: 'flag',
    source: 'private.storage_lifecycle_runs',
    quality: 'app_calculated',
    details: lastRun ?? null,
  })
  return metrics
}

export async function collectAppMetrics(db: Queryable): Promise<Metric[]> {
  const COST = 'coalesce(provider_cost_usd, estimated_cost_usd)'
  const ai = (
    await db.query<Record<string, string | null>>(
      `select
         coalesce(sum(${COST}) filter (where created_at >= date_trunc('day', now())), 0) as spend_today,
         coalesce(sum(${COST}) filter (where created_at >= date_trunc('month', now())), 0) as spend_month,
         coalesce(sum(total_tokens) filter (where created_at >= date_trunc('month', now())), 0) as tokens_month,
         count(*) filter (where created_at >= date_trunc('day', now())) as requests_today,
         coalesce(sum(audio_ms) filter (where request_kind = 'meeting_transcribe' and created_at >= date_trunc('month', now())), 0) as audio_ms_month,
         coalesce(sum(${COST}) filter (where request_kind = 'meeting_transcribe' and created_at >= date_trunc('month', now())), 0) as stt_cost_month,
         (select max_global_daily_cost_usd from public.ai_runtime_controls where id = 'global') as cap
       from public.ai_usage_events
       where created_at >= least(date_trunc('month', now()), date_trunc('day', now()))
         and status in ('completed', 'failed', 'started')`,
    )
  ).rows[0] ?? {}
  const cap = n(ai.cap)
  const spendToday = Number(ai.spend_today ?? 0)
  const ledger = 'public.ai_usage_events (Hilm AI ledger)'
  const metrics: Metric[] = [
    { metric: 'ai.spend_today_usd', value: spendToday, unit: 'usd', source: ledger, quality: 'app_calculated' },
    { metric: 'ai.spend_month_usd', value: Number(ai.spend_month ?? 0), unit: 'usd', source: ledger, quality: 'app_calculated' },
    { metric: 'ai.tokens_month', value: Number(ai.tokens_month ?? 0), unit: 'tokens', source: ledger, quality: 'app_calculated' },
    { metric: 'ai.requests_today', value: Number(ai.requests_today ?? 0), unit: 'requests', source: ledger, quality: 'app_calculated' },
    {
      metric: 'ai.spend_today_pct_of_cap',
      value: cap && cap > 0 ? (spendToday / cap) * 100 : null,
      unit: 'percent',
      source: ledger,
      quality: 'app_calculated',
      details: { cap_usd: cap },
    },
    {
      metric: 'soniox.audio_hours_month',
      value: Number(ai.audio_ms_month ?? 0) / 3_600_000,
      unit: 'hours',
      source: 'Hilm AI ledger (meeting_transcribe); Soniox has no usage API',
      quality: 'app_calculated',
    },
    {
      metric: 'soniox.cost_month_usd',
      value: Number(ai.stt_cost_month ?? 0),
      unit: 'usd',
      source: 'Hilm AI ledger at the published Soniox rate',
      quality: 'app_calculated',
    },
  ]

  const email = (
    await db.query<Record<string, string>>(
      `select count(*) filter (where status = 'sent' and updated_at >= date_trunc('day', now())) as sent_today,
              count(*) filter (where status = 'sent' and updated_at >= date_trunc('month', now())) as sent_month,
              count(*) filter (where status = 'failed' and updated_at > now() - interval '7 days') as failed_7d,
              count(*) filter (where status in ('pending', 'sending')) as queued
       from private.email_outbox where updated_at > least(date_trunc('month', now()), now() - interval '7 days') or status in ('pending', 'sending')`,
    )
  ).rows[0] ?? {}
  const outbox = 'private.email_outbox (notification and product email; sign-in emails are not counted)'
  metrics.push(
    { metric: 'email.sent_today', value: Number(email.sent_today ?? 0), unit: 'emails', source: outbox, quality: 'app_calculated' },
    { metric: 'email.sent_month', value: Number(email.sent_month ?? 0), unit: 'emails', source: outbox, quality: 'app_calculated' },
    { metric: 'email.failed_7d', value: Number(email.failed_7d ?? 0), unit: 'emails', source: outbox, quality: 'app_calculated' },
    { metric: 'email.queued', value: Number(email.queued ?? 0), unit: 'emails', source: outbox, quality: 'app_calculated' },
  )

  const activity = (
    await db.query<Record<string, string>>(
      `select (select count(*) from auth.users where deleted_at is null and coalesce(raw_app_meta_data ->> 'hilm_service', '') = '') as users,
              (select count(*) from auth.users where last_sign_in_at > now() - interval '1 day' and coalesce(raw_app_meta_data ->> 'hilm_service', '') = '') as active_1d,
              (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days' and coalesce(raw_app_meta_data ->> 'hilm_service', '') = '') as active_7d,
              (select count(*) from public.workspaces) as workspaces,
              (select count(*) from public.meetings where created_at >= date_trunc('month', now()))
                + (select count(*) from public.workspace_meetings where created_at >= date_trunc('month', now())) as meetings_month`,
    )
  ).rows[0] ?? {}
  const app = 'Hilm database'
  metrics.push(
    { metric: 'app.users', value: Number(activity.users ?? 0), unit: 'users', source: app, quality: 'app_calculated' },
    { metric: 'app.active_users_1d', value: Number(activity.active_1d ?? 0), unit: 'users', source: 'auth.users last sign-in', quality: 'app_calculated' },
    { metric: 'app.active_users_7d', value: Number(activity.active_7d ?? 0), unit: 'users', source: 'auth.users last sign-in', quality: 'app_calculated' },
    { metric: 'app.workspaces', value: Number(activity.workspaces ?? 0), unit: 'organizations', source: app, quality: 'app_calculated' },
    { metric: 'app.meetings_month', value: Number(activity.meetings_month ?? 0), unit: 'meetings', source: app, quality: 'app_calculated' },
  )

  const fns = (
    await db.query<{ fn: string; invocations: string; errors: string; total_ms: string; max_ms: string }>(
      `select fn, sum(invocations) as invocations, sum(errors) as errors, sum(total_ms) as total_ms, max(max_ms) as max_ms
       from private.ops_function_daily where day >= date_trunc('month', now())::date group by fn order by 2 desc`,
    )
  ).rows
  metrics.push({
    metric: 'netlify.function_breakdown',
    value: fns.reduce((sum, f) => sum + Number(f.invocations), 0),
    unit: 'requests',
    source: 'Hilm per-function counters (since instrumentation was deployed)',
    quality: 'app_calculated',
    details: fns.map((f) => ({
      fn: f.fn,
      invocations: Number(f.invocations),
      errors: Number(f.errors),
      avgMs: Number(f.invocations) ? Math.round(Number(f.total_ms) / Number(f.invocations)) : 0,
      maxMs: Number(f.max_ms),
    })),
  })
  return metrics
}

type FetchLike = typeof fetch

export async function collectNetlifyMetrics(env: Record<string, string | undefined>, fetchImpl: FetchLike = fetch): Promise<Metric[]> {
  const token = env.NETLIFY_API_TOKEN
  const siteId = env.NETLIFY_SITE_ID || env.SITE_ID
  if (!token || !siteId) {
    return ['netlify.function_invocations', 'netlify.function_runtime_seconds', 'netlify.bandwidth_bytes'].map((metric) => ({
      metric,
      value: null,
      unit: metric.endsWith('bytes') ? 'bytes' : metric.endsWith('seconds') ? 'seconds' : 'requests',
      source: 'Netlify API (NETLIFY_API_TOKEN not configured)',
      quality: 'unavailable' as const,
    }))
  }
  const headers = { Authorization: `Bearer ${token}` }
  const get = async (path: string) => {
    const response = await fetchImpl(`https://api.netlify.com/api/v1${path}`, { headers, signal: AbortSignal.timeout(8_000) })
    if (!response.ok) throw new Error(`netlify ${path.split('/')[1]} ${response.status}`)
    return response.json() as Promise<unknown>
  }
  const metrics: Metric[] = []
  const usage = (await get(`/sites/${siteId}/usage`)) as Array<{
    type: string
    capabilities?: Record<string, { used?: number; included?: number; unit?: string }>
    last_updated_at?: string
    period_start_date?: string
    period_end_date?: string
  }>
  const fns = usage.find((u) => u.type === 'functions')
  const period = { period_start: fns?.period_start_date, period_end: fns?.period_end_date, provider_updated_at: fns?.last_updated_at }
  metrics.push(
    {
      metric: 'netlify.function_invocations',
      value: n(fns?.capabilities?.invocations?.used),
      unit: 'requests',
      source: 'Netlify site usage API',
      quality: 'provider_synced',
      details: { ...period, included: n(fns?.capabilities?.invocations?.included) },
    },
    {
      metric: 'netlify.function_runtime_seconds',
      value: n(fns?.capabilities?.runtime?.used),
      unit: 'seconds',
      source: 'Netlify site usage API',
      quality: 'provider_synced',
      details: { ...period, included: n(fns?.capabilities?.runtime?.included) },
    },
  )
  const site = (await get(`/sites/${siteId}`)) as { account_id?: string }
  if (site.account_id) {
    const bandwidth = (await get(`/accounts/${site.account_id}/bandwidth`)) as {
      used?: number
      included?: number
      last_updated_at?: string
      period_start_date?: string
      period_end_date?: string
    }
    metrics.push({
      metric: 'netlify.bandwidth_bytes',
      value: n(bandwidth.used),
      unit: 'bytes',
      source: 'Netlify account bandwidth API',
      quality: 'provider_synced',
      details: {
        included: n(bandwidth.included),
        provider_updated_at: bandwidth.last_updated_at,
        period_start: bandwidth.period_start_date,
        period_end: bandwidth.period_end_date,
      },
    })
  }
  return metrics
}

export async function collectOpenRouterMetrics(apiKey: string | null, fetchImpl: FetchLike = fetch): Promise<Metric[]> {
  if (!apiKey) {
    return [{ metric: 'openrouter.key_usage_usd', value: null, unit: 'usd', source: 'OpenRouter key not configured', quality: 'unavailable' }]
  }
  const response = await fetchImpl('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`openrouter key ${response.status}`)
  const body = (await response.json()) as {
    data?: { usage?: number; usage_daily?: number; usage_monthly?: number; limit?: number | null; limit_remaining?: number | null; is_free_tier?: boolean }
  }
  const data = body.data ?? {}
  return [
    {
      metric: 'openrouter.key_usage_usd',
      value: n(data.usage),
      unit: 'usd',
      source: 'OpenRouter /api/v1/key (lifetime usage of this key)',
      quality: 'provider_live',
      details: {
        usage_daily: n(data.usage_daily),
        usage_monthly: n(data.usage_monthly),
        limit: n(data.limit),
        limit_remaining: n(data.limit_remaining),
        is_free_tier: data.is_free_tier ?? null,
      },
    },
  ]
}

export async function collectBlobMetrics(listStore: () => Promise<Array<{ key: string; size: number | null }>>): Promise<Metric[]> {
  const blobs = await listStore()
  const sized = blobs.filter((b) => b.size != null)
  return [
    {
      metric: 'netlify.blobs_email_assets',
      value: sized.length === blobs.length ? sized.reduce((sum, b) => sum + (b.size ?? 0), 0) : null,
      unit: 'bytes',
      source: 'Netlify Blobs store email-assets',
      quality: 'provider_live',
      details: { objects: blobs.length },
    },
  ]
}

export async function writeSnapshots(db: Queryable, metrics: Metric[]) {
  if (!metrics.length) return 0
  await db.query(
    `insert into private.ops_metric_snapshots (metric, scope, value, unit, source, quality, details)
     select m.metric, coalesce(m.scope, 'global'), m.value, m.unit, m.source, m.quality, m.details
     from jsonb_to_recordset($1::jsonb) as m(metric text, scope text, value numeric, unit text, source text, quality text, details jsonb)`,
    [JSON.stringify(metrics.map((m) => ({ ...m, details: m.details ?? null })))],
  )
  return metrics.length
}

export type CollectorDeps = {
  env: Record<string, string | undefined>
  fetch?: FetchLike
  openRouterKey?: () => Promise<string | null>
  listBlobs?: () => Promise<Array<{ key: string; size: number | null }>>
  includeDaily?: boolean
}

/** Collects everything; one failing source is recorded and does not stop the others. */
export async function runMetricsCollection(db: Queryable, deps: CollectorDeps) {
  const errors: string[] = []
  const metrics: Metric[] = []
  const attempt = async (name: string, fn: () => Promise<Metric[]>) => {
    try {
      metrics.push(...(await fn()))
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message.slice(0, 160) : 'failed'}`)
    }
  }
  await attempt('database', () => collectDatabaseMetrics(db))
  await attempt('storage', () => collectStorageMetrics(db))
  await attempt('app', () => collectAppMetrics(db))
  await attempt('netlify', () => collectNetlifyMetrics(deps.env, deps.fetch))
  await attempt('openrouter', async () => collectOpenRouterMetrics(deps.openRouterKey ? await deps.openRouterKey() : null, deps.fetch))
  if (deps.includeDaily && deps.listBlobs) await attempt('blobs', () => collectBlobMetrics(deps.listBlobs!))
  const written = await writeSnapshots(db, metrics)
  return { written, errors }
}

/** Keeps 7 days of hourly detail and one snapshot per metric per day for 400 days. */
export async function pruneSnapshots(db: Queryable) {
  const { rows } = await db.query<{ n: string }>(
    `with doomed as (
       select id from private.ops_metric_snapshots s
       where (s.collected_at < now() - interval '400 days')
          or (s.collected_at < now() - interval '7 days' and exists (
                select 1 from private.ops_metric_snapshots k
                where k.metric = s.metric and k.scope = s.scope
                  and k.collected_at::date = s.collected_at::date and k.collected_at > s.collected_at))
       limit 20000
     ), gone as (delete from private.ops_metric_snapshots s using doomed d where s.id = d.id returning 1)
     select count(*) as n from gone`,
  )
  await db.query(`delete from private.ops_function_daily where day < current_date - 400`)
  await db.query(`delete from private.ops_alerts where resolved_at < now() - interval '400 days'`)
  return Number(rows[0]?.n ?? 0)
}
