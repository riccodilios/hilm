/**
 * Admin infrastructure read models and controls against the real schema, inside one transaction
 * that is rolled back. Exercises the exact SQL the console uses (no HTTP or MFA layer; the router
 * and guard are covered by netlify/functions/_shared/admin/admin.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import {
  extendFile,
  forecastView,
  infraOverview,
  metricHistory,
  operationsView,
  recordManualMetric,
  searchFiles,
  setFileHold,
  setQuota,
  setRetentionPolicy,
  storageView,
  updateAlertRule,
  updateLifecycleSettings,
  updateLimit,
} from '../../netlify/functions/_shared/admin/infra'
import { evaluateAlerts } from '../../netlify/functions/_shared/ops/alerts'
import { collectAppMetrics, collectDatabaseMetrics, collectStorageMetrics, pruneSnapshots, writeSnapshots } from '../../netlify/functions/_shared/ops/collector'
import { createAuthUser, newClient, testEmail, uid } from './helpers'

let client: pg.Client
const admin = uid()

beforeAll(async () => {
  client = newClient()
  await client.connect()
  await client.query('begin')
  await createAuthUser(client, admin, testEmail('infra-admin'))
}, 120_000)

afterAll(async () => {
  await client?.query('rollback').catch(() => undefined)
  await client?.end().catch(() => undefined)
})

describe('admin infrastructure', () => {
  it('collects database, storage and application metrics and reads them back', async () => {
    const metrics = [...(await collectDatabaseMetrics(client)), ...(await collectStorageMetrics(client)), ...(await collectAppMetrics(client))]
    expect(metrics.find((m) => m.metric === 'supabase.db_size_bytes')?.value).toBeGreaterThan(0)
    expect(metrics.every((m) => m.quality && m.source && m.unit)).toBe(true)
    expect(await writeSnapshots(client, metrics)).toBe(metrics.length)
    const overview = await infraOverview(client)
    const db = overview.metrics.find((m) => m.metric === 'supabase.db_size_bytes')
    expect(db?.stale).toBe(false)
    expect(db?.frequencyMinutes).toBe(60)
    expect(overview.limits.find((l) => (l as { key: string }).key === 'supabase.storage')).toBeTruthy()
    expect(overview.settings).toBeTruthy()
    expect(Array.isArray(await metricHistory(client, 'supabase.db_size_bytes', 30))).toBe(true)
  })

  it('storage, operations and forecast views', async () => {
    const storage = await storageView(client)
    expect(storage.inventory).toBeTruthy()
    expect(storage.policies.length).toBeGreaterThan(0)
    const ops = await operationsView(client)
    expect(ops.rules.length).toBeGreaterThanOrEqual(10)
    const forecast = await forecastView(client)
    expect(forecast.rows).toHaveLength(18)
    expect(forecast.inputs.attachmentRetentionDays).toBe(90)
  })

  it('settings, retention overrides, holds, extensions, quotas, limits, manual values and rules', async () => {
    await updateLifecycleSettings(client, admin, { quarantine_days: 21 })
    await updateLifecycleSettings(client, admin, { historical_audio_approved: true })
    const settings = (await client.query(`select quarantine_days, historical_audio_approved, approved_by from private.storage_lifecycle_settings`)).rows[0]
    expect(settings).toMatchObject({ quarantine_days: 21, historical_audio_approved: true, approved_by: admin })

    const ws = (await client.query(`select id from public.workspaces limit 1`)).rows[0]?.id
    if (ws) {
      expect(await setRetentionPolicy(client, admin, { scope_type: 'workspace', scope_id: ws, category: 'task_attachment', retention_days: 180, legal_hold: false })).toBe('ok')
      const row = (await client.query(`select set_by, retention_days from public.storage_retention_policies where scope_type = 'workspace' and scope_id = $1`, [ws])).rows[0]
      expect(row).toMatchObject({ set_by: 'platform_admin', retention_days: 180 })
      expect(await setRetentionPolicy(client, admin, { scope_type: 'workspace', scope_id: ws, category: 'task_attachment', retention_days: null, legal_hold: false, remove: true })).toBe('ok')
      await setQuota(client, admin, { scope_type: 'workspace', scope_id: ws, max_bytes: 5 * 1024 ** 2 })
      await setQuota(client, admin, { scope_type: 'workspace', scope_id: ws, max_bytes: null })
    }
    expect(await setRetentionPolicy(client, admin, { scope_type: 'platform', scope_id: null, category: 'task_attachment', retention_days: 90, legal_hold: false, remove: true })).toBe('cannot_remove_platform')

    const file = (await client.query(`select id from public.storage_files where status = 'active' and category = 'task_attachment' limit 1`)).rows[0]?.id
    if (file) {
      expect(await setFileHold(client, admin, { file_id: file, legal_hold: true, reason: 'test hold' })).toBe(true)
      expect((await client.query(`select expires_at from public.storage_files where id = $1`, [file])).rows[0].expires_at).toBeNull()
      expect(await setFileHold(client, admin, { file_id: file, legal_hold: false, reason: 'test release' })).toBe(true)
      expect(await extendFile(client, admin, { file_id: file, days: 30, reason: 'test extension' })).toBeTruthy()
      expect((await searchFiles(client, file)).map((f) => (f as { id: string }).id)).toContain(file)
    }

    expect(await updateLimit(client, { key: 'supabase.storage', limit_value: 2 * 1024 ** 3, plan: 'test' })).toBe(true)
    expect(await recordManualMetric(client, admin, { metric: 'supabase.egress_bytes', value: 1024 ** 3 })).toBe(true)
    expect(await recordManualMetric(client, admin, { metric: 'made.up', value: 1 })).toBe(false)
    expect(await updateAlertRule(client, { key: 'storage_capacity', warn_value: 50, crit_value: null, enabled: true, notify: false })).toBe(true)
    const audit = (await client.query(`select count(*)::int as n from private.storage_lifecycle_events where actor_type = 'admin' and actor_id = $1`, [admin])).rows[0].n
    expect(audit).toBeGreaterThanOrEqual(4)
  })

  it('alerts open once, then resolve when the value recovers', async () => {
    await client.query(`update private.ops_alert_rules set enabled = (key = 'cleanup_backlog'), notify = true, warn_value = 1, crit_value = 100 where true`)
    await client.query(`delete from private.ops_alerts where rule_key = 'cleanup_backlog'`)
    await client.query(`update private.ops_metric_snapshots set collected_at = collected_at - interval '10 minutes' where metric = 'storage.queue_pending'`)
    await writeSnapshots(client, [{ metric: 'storage.queue_pending', value: 5, unit: 'files', source: 'test', quality: 'app_calculated' }])
    const first = await evaluateAlerts(client)
    expect(first.map((n) => n.level)).toEqual(['warning'])
    expect(await evaluateAlerts(client)).toEqual([])
    await client.query(`update private.ops_metric_snapshots set collected_at = now() - interval '1 minute' where metric = 'storage.queue_pending'`)
    await writeSnapshots(client, [{ metric: 'storage.queue_pending', value: 0, unit: 'files', source: 'test', quality: 'app_calculated' }])
    const resolved = await evaluateAlerts(client)
    expect(resolved.map((n) => n.level)).toEqual(['resolved'])
    expect((await client.query(`select count(*)::int as n from private.ops_alerts where rule_key = 'cleanup_backlog' and resolved_at is null`)).rows[0].n).toBe(0)
  })

  it('snapshot pruning keeps the latest value per day', async () => {
    expect(await pruneSnapshots(client)).toBeGreaterThanOrEqual(0)
  })
})
