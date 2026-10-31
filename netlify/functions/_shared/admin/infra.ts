/**
 * Admin read models and controls for infrastructure, storage and retention. Reads come from the
 * cached snapshots written by the scheduler (private.ops_metric_snapshots) and from small indexed
 * tables; nothing here scans storage or calls a provider on page view.
 */
import type pg from 'pg'
import { z } from 'zod'
import { FREE_LIMITS, forecastMatrix, daysUntilLimit, type Limits } from '../ops/forecast.ts'

type Db = Pick<pg.Client, 'query'>

/** How often each metric family is refreshed; older than twice this is flagged stale. */
export function expectedMinutes(metric: string) {
  if (metric === 'netlify.blobs_email_assets') return 1440
  return 60
}

export async function latestMetrics(db: Db) {
  const { rows } = await db.query<{
    metric: string
    scope: string
    value: string | null
    unit: string
    source: string
    quality: string
    details: unknown
    collected_at: string
  }>(
    `select distinct on (metric, scope) metric, scope, value, unit, source, quality, details, collected_at
     from private.ops_metric_snapshots
     where collected_at > now() - interval '30 days'
     order by metric, scope, collected_at desc`,
  )
  const now = Date.now()
  return rows.map((r) => {
    const frequencyMinutes = r.quality === 'manual' ? null : expectedMinutes(r.metric)
    const ageMinutes = (now - Date.parse(r.collected_at)) / 60_000
    return {
      ...r,
      value: r.value == null ? null : Number(r.value),
      frequencyMinutes,
      stale: frequencyMinutes != null && ageMinutes > frequencyMinutes * 2,
    }
  })
}

export async function infraOverview(db: Db) {
  const [metrics, limits, alerts, collectors, runs, settings] = await Promise.all([
    latestMetrics(db),
    db.query(`select key, label, limit_value, unit, plan, quality, source, verified_at, notes from private.ops_limits order by key`),
    db.query(
      `select id::text, rule_key, level, value, threshold, message, opened_at, last_notified_at
       from private.ops_alerts where resolved_at is null order by opened_at desc`,
    ),
    db.query(`select collector, interval_minutes, last_attempt_at, last_success_at, last_error from private.ops_collector_state order by collector`),
    db.query(
      `select id, trigger, mode, status, started_at, finished_at, stats, error
       from private.storage_lifecycle_runs order by started_at desc limit 5`,
    ),
    lifecycleSettings(db),
  ])
  return { metrics, limits: limits.rows, alerts: alerts.rows, collectors: collectors.rows, runs: runs.rows, settings }
}

export async function metricHistory(db: Db, metric: string, days: number) {
  const span = Math.max(1, Math.min(400, Math.floor(days) || 30))
  const { rows } = await db.query(
    `select distinct on (collected_at::date, scope) collected_at::date::text as day, scope, value, quality
     from private.ops_metric_snapshots
     where metric = $1 and collected_at > now() - make_interval(days => $2)
     order by collected_at::date, scope, collected_at desc`,
    [metric, span],
  )
  return rows
}

export async function lifecycleSettings(db: Db) {
  const { rows } = await db.query(
    `select mode, quarantine_days, abandoned_upload_hours, orphan_grace_hours, max_deletions_per_run, max_bytes_per_run,
            circuit_breaker_files, max_delete_attempts, audio_disposal_enabled, historical_audio_cutoff, historical_audio_approved,
            attachment_max_bytes, default_user_quota_bytes, default_workspace_quota_bytes, user_max_retention_days,
            workspace_max_retention_days, approved_by, approved_at, updated_at, lease_until
     from private.storage_lifecycle_settings`,
  )
  return rows[0] ?? null
}

export async function storageView(db: Db) {
  const [inventory, policies, quotas, top, holds, failed, events, runs] = await Promise.all([
    db.query(
      `select details, collected_at from private.ops_metric_snapshots where metric = 'storage.inventory' order by collected_at desc limit 1`,
    ),
    db.query(
      `select p.id, p.scope_type, p.scope_id, p.category, p.retention_days, p.legal_hold, p.set_by, p.updated_at,
              coalesce(w.name, u.email) as scope_name
       from public.storage_retention_policies p
       left join public.workspaces w on p.scope_type = 'workspace' and w.id = p.scope_id
       left join auth.users u on p.scope_type = 'user' and u.id = p.scope_id
       order by p.scope_type, p.updated_at desc limit 500`,
    ),
    db.query(
      `select q.scope_type, q.scope_id, q.max_bytes, q.updated_at, coalesce(w.name, u.email) as scope_name
       from public.storage_quota_overrides q
       left join public.workspaces w on q.scope_type = 'workspace' and w.id = q.scope_id
       left join auth.users u on q.scope_type = 'user' and u.id = q.scope_id
       order by q.updated_at desc limit 500`,
    ),
    db.query(
      `select u.scope_type, u.scope_id, coalesce(w.name, au.email) as scope_name, u.category, u.files_active, u.bytes_active, u.bytes_pending
       from public.storage_usage u
       left join public.workspaces w on u.scope_type = 'workspace' and w.id = u.scope_id
       left join auth.users au on u.scope_type = 'user' and au.id = u.scope_id
       order by u.bytes_active desc limit 25`,
    ),
    db.query(
      `select id, category, scope, original_filename, size_bytes, workspace_id, owner_user_id, status, expires_at
       from public.storage_files where legal_hold order by updated_at desc limit 100`,
    ),
    db.query(
      `select d.id::text, d.provider, d.bucket_id, d.object_name, d.reason, d.attempts, d.last_error, d.failed_at
       from private.storage_object_deletions d where d.status = 'failed' order by d.failed_at desc nulls last limit 50`,
    ),
    db.query(
      `select id::text, occurred_at, run_id, file_id, action, actor_type, bytes, details
       from private.storage_lifecycle_events order by occurred_at desc limit 100`,
    ),
    db.query(
      `select id, trigger, mode, status, started_at, finished_at, stats, error
       from private.storage_lifecycle_runs order by started_at desc limit 30`,
    ),
  ])
  return {
    inventory: inventory.rows[0] ?? null,
    settings: await lifecycleSettings(db),
    policies: policies.rows,
    quotas: quotas.rows,
    topUsage: top.rows,
    legalHolds: holds.rows,
    failedDeletions: failed.rows,
    events: events.rows,
    runs: runs.rows,
  }
}

export async function searchFiles(db: Db, q: string) {
  const term = q.trim().toLowerCase().slice(0, 120)
  const { rows } = await db.query(
    `select f.id, f.category, f.scope, f.original_filename, f.size_bytes, f.status, f.legal_hold, f.expires_at, f.retain_until,
            f.created_at, w.name as workspace_name, u.email as owner_email
     from public.storage_files f
     left join public.workspaces w on w.id = f.workspace_id
     left join auth.users u on u.id = f.owner_user_id
     where f.status <> 'deleted'
       and ($1 = '' or lower(coalesce(f.original_filename, '')) like '%' || $1 || '%'
            or lower(coalesce(w.name, '')) like '%' || $1 || '%' or lower(coalesce(u.email, '')) like '%' || $1 || '%'
            or f.id::text = $1)
     order by f.created_at desc limit 50`,
    [term],
  )
  return rows
}

export async function operationsView(db: Db) {
  const [runs, alerts, rules, collectors, queue, functions] = await Promise.all([
    db.query(
      `select id, trigger, mode, status, started_at, finished_at, stats, error
       from private.storage_lifecycle_runs order by started_at desc limit 50`,
    ),
    db.query(
      `select id::text, rule_key, level, value, threshold, message, opened_at, last_notified_at, resolved_at
       from private.ops_alerts order by opened_at desc limit 100`,
    ),
    db.query(`select * from private.ops_alert_rules order by key`),
    db.query(`select collector, interval_minutes, last_attempt_at, last_success_at, last_error from private.ops_collector_state order by collector`),
    db.query(
      `select status, count(*)::int as n, min(requested_at) as oldest from private.storage_object_deletions group by status`,
    ),
    db.query(
      `select day::text, fn, invocations, errors, total_ms, max_ms from private.ops_function_daily
       where day > current_date - 14 order by day desc, invocations desc`,
    ),
  ])
  return {
    runs: runs.rows,
    alerts: alerts.rows,
    rules: rules.rows,
    collectors: collectors.rows,
    queue: queue.rows,
    functions: functions.rows,
  }
}

const metricValue = (metrics: Array<{ metric: string; value: number | null }>, key: string) =>
  metrics.find((m) => m.metric === key)?.value ?? null

export async function forecastView(db: Db) {
  const metrics = await latestMetrics(db)
  const limits = (await db.query<{ key: string; limit_value: string | null }>(`select key, limit_value from private.ops_limits`)).rows
  const limit = (key: string, fallback: number) => {
    const row = limits.find((l) => l.key === key)
    return row?.limit_value != null ? Number(row.limit_value) : fallback
  }
  const planLimits: Limits = {
    storageBytes: limit('supabase.storage', FREE_LIMITS.storageBytes),
    dbBytes: limit('supabase.db_size', FREE_LIMITS.dbBytes),
    egressBytes: limit('supabase.egress', FREE_LIMITS.egressBytes),
    invocations: limit('netlify.function_invocations', FREE_LIMITS.invocations),
    bandwidthBytes: limit('netlify.bandwidth', FREE_LIMITS.bandwidthBytes),
    emailsMonth: limit('resend.monthly_emails', FREE_LIMITS.emailsMonth),
    emailsDay: limit('resend.daily_emails', FREE_LIMITS.emailsDay),
  }
  const settings = await lifecycleSettings(db)
  const policy = (
    await db.query<{ retention_days: number | null }>(
      `select retention_days from public.storage_retention_policies where scope_type = 'platform' and category = 'task_attachment'`,
    )
  ).rows[0]
  const sonioxRate = limit('soniox.hourly_rate_usd', 0.1)
  const inputs = {
    audioBytesPerHour: metricValue(metrics, 'storage.audio_bytes_per_hour'),
    currentDbBytes: metricValue(metrics, 'supabase.db_size_bytes'),
    fixedInvocationsMonth: 44_640,
    attachmentRetentionDays: policy?.retention_days ?? 90,
    quarantineDays: Number(settings?.quarantine_days ?? 14),
    audioRetentionDays: settings?.audio_disposal_enabled ? 0 : 365,
    sonioxUsdPerHour: sonioxRate,
    horizonMonths: 12,
  }

  // Current trend: storage growth over the last 7 days of snapshots.
  const trend = (
    await db.query<{ first: string | null; last: string | null; days: string | null }>(
      `select (array_agg(value order by collected_at))[1] as first, (array_agg(value order by collected_at desc))[1] as last,
              extract(epoch from max(collected_at) - min(collected_at)) / 86400 as days
       from private.ops_metric_snapshots where metric = 'supabase.storage_bytes' and collected_at > now() - interval '7 days'`,
    )
  ).rows[0]
  const storageNow = metricValue(metrics, 'supabase.storage_bytes')
  const span = Number(trend?.days ?? 0)
  const dailyGrowth = span >= 1 ? (Number(trend?.last ?? 0) - Number(trend?.first ?? 0)) / span : null
  const dbTrend = (
    await db.query<{ first: string | null; last: string | null; days: string | null }>(
      `select (array_agg(value order by collected_at))[1] as first, (array_agg(value order by collected_at desc))[1] as last,
              extract(epoch from max(collected_at) - min(collected_at)) / 86400 as days
       from private.ops_metric_snapshots where metric = 'supabase.db_size_bytes' and collected_at > now() - interval '7 days'`,
    )
  ).rows[0]
  const dbSpan = Number(dbTrend?.days ?? 0)
  const dbDaily = dbSpan >= 1 ? (Number(dbTrend?.last ?? 0) - Number(dbTrend?.first ?? 0)) / dbSpan : null
  const dbNow = metricValue(metrics, 'supabase.db_size_bytes')

  return {
    inputs,
    limits: planLimits,
    rows: forecastMatrix(inputs, planLimits),
    current: {
      organizations: metricValue(metrics, 'app.workspaces'),
      users: metricValue(metrics, 'app.users'),
      storageBytes: storageNow,
      storageDailyGrowth: dailyGrowth,
      storageDaysToLimit: storageNow != null && dailyGrowth != null ? daysUntilLimit(storageNow, dailyGrowth, planLimits.storageBytes) : null,
      dbBytes: dbNow,
      dbDailyGrowth: dbDaily,
      dbDaysToLimit: dbNow != null && dbDaily != null ? daysUntilLimit(dbNow, dbDaily, planLimits.dbBytes) : null,
      trendDays: Math.max(span, dbSpan),
    },
  }
}

// ── Mutations ───────────────────────────────────────────────────────────────

export const settingsSchema = z
  .object({
    mode: z.enum(['off', 'dry_run', 'quarantine', 'enforce']),
    quarantine_days: z.number().int().min(1).max(365),
    abandoned_upload_hours: z.number().int().min(1).max(720),
    orphan_grace_hours: z.number().int().min(1).max(720),
    max_deletions_per_run: z.number().int().min(1).max(5000),
    max_bytes_per_run: z.number().int().min(1024 ** 2).max(1024 ** 4),
    circuit_breaker_files: z.number().int().min(1).max(1_000_000),
    max_delete_attempts: z.number().int().min(1).max(50),
    audio_disposal_enabled: z.boolean(),
    historical_audio_approved: z.boolean(),
    attachment_max_bytes: z.number().int().min(1024).max(50 * 1024 ** 2),
    default_user_quota_bytes: z.number().int().min(0).max(1024 ** 4),
    default_workspace_quota_bytes: z.number().int().min(0).max(1024 ** 4),
    user_max_retention_days: z.number().int().min(7).max(36500),
    workspace_max_retention_days: z.number().int().min(7).max(36500),
  })
  .partial()
  .strict()

export async function updateLifecycleSettings(db: Db, adminId: string, patch: z.infer<typeof settingsSchema>) {
  const keys = Object.keys(patch) as Array<keyof typeof patch>
  if (!keys.length) return
  const sets = keys.map((k, i) => `${k} = $${i + 2}`)
  const approving = patch.historical_audio_approved === true || patch.mode === 'enforce'
  await db.query(
    `update private.storage_lifecycle_settings set ${sets.join(', ')}, updated_at = now()
       ${approving ? ', approved_by = $1, approved_at = now()' : ''}
     where id`,
    [adminId, ...keys.map((k) => patch[k])],
  )
  if (patch.attachment_max_bytes != null) {
    await db.query(`update storage.buckets set file_size_limit = $1 where id = 'attachments'`, [patch.attachment_max_bytes])
  }
  await db.query(
    `insert into private.storage_lifecycle_events (action, actor_type, actor_id, details) values ('settings_changed', 'admin', $1, $2::jsonb)`,
    [adminId, JSON.stringify(patch)],
  )
}

export const retentionSchema = z
  .object({
    scope_type: z.enum(['platform', 'workspace', 'user']),
    scope_id: z.string().uuid().nullable(),
    category: z.enum(['task_attachment', 'meeting_audio']),
    retention_days: z.number().int().min(1).max(36500).nullable(),
    legal_hold: z.boolean().default(false),
    remove: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.scope_type === 'platform') === (v.scope_id === null), { message: 'scope_id' })

export async function setRetentionPolicy(db: Db, adminId: string, input: z.infer<typeof retentionSchema>) {
  if (input.remove) {
    if (input.scope_type === 'platform') return 'cannot_remove_platform'
    await db.query(
      `delete from public.storage_retention_policies where scope_type = $1 and scope_id = $2 and category = $3`,
      [input.scope_type, input.scope_id, input.category],
    )
  } else {
    await db.query(
      `insert into public.storage_retention_policies (scope_type, scope_id, category, retention_days, legal_hold, set_by, updated_by)
       values ($1, $2, $3, $4, $5, 'platform_admin', $6)
       on conflict (scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), category)
       do update set retention_days = excluded.retention_days, legal_hold = excluded.legal_hold,
         set_by = 'platform_admin', updated_by = excluded.updated_by, updated_at = now()`,
      [input.scope_type, input.scope_id, input.category, input.retention_days, input.legal_hold, adminId],
    )
  }
  await db.query(
    `insert into private.storage_lifecycle_events (action, actor_type, actor_id, details) values ($1, 'admin', $2, $3::jsonb)`,
    [input.remove ? 'retention_override_removed' : 'retention_policy_set', adminId, JSON.stringify(input)],
  )
  return 'ok'
}

export const holdSchema = z.object({ file_id: z.string().uuid(), legal_hold: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict()

export async function setFileHold(db: Db, adminId: string, input: z.infer<typeof holdSchema>) {
  const { rowCount } = await db.query(
    `update public.storage_files set legal_hold = $2, updated_at = now() where id = $1 and status not in ('deleted', 'deleting')`,
    [input.file_id, input.legal_hold],
  )
  if (!rowCount) return false
  await db.query(
    `insert into private.storage_lifecycle_events (file_id, action, actor_type, actor_id, details) values ($1, $2, 'admin', $3, $4::jsonb)`,
    [input.file_id, input.legal_hold ? 'legal_hold_set' : 'legal_hold_released', adminId, JSON.stringify({ reason: input.reason })],
  )
  return true
}

export const extendSchema = z.object({ file_id: z.string().uuid(), days: z.number().int().min(1).max(3650), reason: z.string().trim().min(3).max(300) }).strict()

/** Admin extension: never shortens; restores a quarantined file to active. */
export async function extendFile(db: Db, adminId: string, input: z.infer<typeof extendSchema>) {
  const { rows } = await db.query<{ expires_at: string | null; status: string }>(
    `update public.storage_files
     set retain_until = greatest(coalesce(retain_until, now()), now() + make_interval(days => $2)),
         status = case when status = 'quarantined' then 'active' else status end,
         quarantined_at = case when status = 'quarantined' then null else quarantined_at end,
         purge_after = case when status = 'quarantined' then null else purge_after end,
         updated_at = now()
     where id = $1 and status in ('active', 'quarantined')
     returning expires_at, status`,
    [input.file_id, input.days],
  )
  if (!rows.length) return null
  await db.query(
    `insert into private.storage_lifecycle_events (file_id, action, actor_type, actor_id, details) values ($1, 'retention_extended', 'admin', $2, $3::jsonb)`,
    [input.file_id, adminId, JSON.stringify({ days: input.days, reason: input.reason })],
  )
  return rows[0]
}

export const quotaSchema = z
  .object({ scope_type: z.enum(['user', 'workspace']), scope_id: z.string().uuid(), max_bytes: z.number().int().min(0).max(1024 ** 4).nullable() })
  .strict()

export async function setQuota(db: Db, adminId: string, input: z.infer<typeof quotaSchema>) {
  if (input.max_bytes == null) {
    await db.query(`delete from public.storage_quota_overrides where scope_type = $1 and scope_id = $2`, [input.scope_type, input.scope_id])
  } else {
    await db.query(
      `insert into public.storage_quota_overrides (scope_type, scope_id, max_bytes, updated_by) values ($1, $2, $3, $4)
       on conflict (scope_type, scope_id) do update set max_bytes = excluded.max_bytes, updated_by = excluded.updated_by, updated_at = now()`,
      [input.scope_type, input.scope_id, input.max_bytes, adminId],
    )
  }
  await db.query(
    `insert into private.storage_lifecycle_events (action, actor_type, actor_id, details) values ('quota_changed', 'admin', $1, $2::jsonb)`,
    [adminId, JSON.stringify(input)],
  )
}

export const limitSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_.]{3,64}$/),
    limit_value: z.number().min(0).nullable(),
    plan: z.string().trim().max(60).nullable().optional(),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .strict()

export async function updateLimit(db: Db, input: z.infer<typeof limitSchema>) {
  const { rowCount } = await db.query(
    `update private.ops_limits set limit_value = $2, plan = coalesce($3, plan), notes = coalesce($4, notes),
       quality = 'manual', source = 'Entered by platform admin', verified_at = now(), updated_at = now()
     where key = $1`,
    [input.key, input.limit_value, input.plan ?? null, input.notes ?? null],
  )
  return Boolean(rowCount)
}

/** Metrics no API exposes; an admin can record the value shown in the provider dashboard. */
export const MANUAL_METRICS: Record<string, { unit: string; label: string }> = {
  'supabase.egress_bytes': { unit: 'bytes', label: 'Supabase egress this billing period' },
  'resend.sent_month_provider': { unit: 'emails', label: 'Resend emails this month (dashboard)' },
  'soniox.balance_usd': { unit: 'usd', label: 'Soniox remaining balance' },
}

export const manualMetricSchema = z.object({ metric: z.string(), value: z.number().min(0), note: z.string().trim().max(200).optional() }).strict()

export async function recordManualMetric(db: Db, adminId: string, input: z.infer<typeof manualMetricSchema>) {
  const spec = MANUAL_METRICS[input.metric]
  if (!spec) return false
  await db.query(
    `insert into private.ops_metric_snapshots (metric, value, unit, source, quality, details)
     values ($1, $2, $3, 'Entered by platform admin from the provider dashboard', 'manual', $4::jsonb)`,
    [input.metric, input.value, spec.unit, JSON.stringify({ admin_id: adminId, note: input.note ?? null })],
  )
  return true
}

export const ruleSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{3,64}$/),
    warn_value: z.number().nullable().optional(),
    crit_value: z.number().nullable().optional(),
    cooldown_hours: z.number().int().min(1).max(720).optional(),
    notify: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

export async function updateAlertRule(db: Db, input: z.infer<typeof ruleSchema>) {
  const { rowCount } = await db.query(
    `update private.ops_alert_rules set
       warn_value = case when $2::boolean then $3::numeric else warn_value end,
       crit_value = case when $4::boolean then $5::numeric else crit_value end,
       cooldown_hours = coalesce($6, cooldown_hours),
       notify = coalesce($7, notify),
       enabled = coalesce($8, enabled),
       updated_at = now()
     where key = $1`,
    [
      input.key,
      'warn_value' in input,
      input.warn_value ?? null,
      'crit_value' in input,
      input.crit_value ?? null,
      input.cooldown_hours ?? null,
      input.notify ?? null,
      input.enabled ?? null,
    ],
  )
  return Boolean(rowCount)
}
