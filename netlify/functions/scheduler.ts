/**
 * The only scheduled function (every minute). One schedule instead of several keeps Netlify
 * invocations low: each job below runs only when it is due, tracked in private.ops_collector_state
 * so a skipped minute or a redeploy never runs a job twice or loses it.
 *
 *  every minute  task reminders, transactional email outbox
 *  10 minutes    storage lifecycle (retention, quarantine, audio disposal, deletion queue), alerts
 *  hourly        infrastructure metrics
 *  daily         usage reconciliation, snapshot pruning, Netlify Blobs size
 *
 * Not publicly routed; Netlify answers 403 to outside requests for scheduled functions.
 */
import { createHash } from 'node:crypto'
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import type pg from 'pg'
import { authorizeCronRequest } from './_shared/cron-auth'
import { acquireDb, databaseUrl, isRetryableDbError } from './_shared/db.ts'
import { loadOpenRouterKey } from './_shared/ai-guard.ts'
import { loadEmailConfig } from './_shared/email/config.ts'
import { EMAIL_ASSET_STORE } from './_shared/email/images.ts'
import { createEmailService } from './_shared/email/service.ts'
import { opsAlertEmail } from './_shared/email/templates.ts'
import { drainEmail, loadReminderSecrets, runTaskReminders } from './_shared/jobs/reminders.ts'
import { evaluateAlerts, type AlertNotice } from './_shared/ops/alerts.ts'
import { pruneSnapshots, runMetricsCollection } from './_shared/ops/collector.ts'
import { instrumented } from './_shared/ops/instrument.ts'
import { storageProviders } from './_shared/storage/index.ts'
import { runStorageLifecycle } from './_shared/storage/lifecycle.ts'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

/** Scheduled functions are stopped after 30 s. */
const BUDGET_MS = 25_000

/** Atomically claims a periodic job; false when it is not due or another run has it. */
async function claimJob(db: pg.PoolClient, collector: string) {
  const { rows } = await db.query(
    `update private.ops_collector_state set last_attempt_at = now()
     where collector = $1
       and (last_attempt_at is null or last_attempt_at <= now() - make_interval(mins => interval_minutes) + interval '20 seconds')
     returning collector`,
    [collector],
  )
  return rows.length > 0
}

async function finishJob(db: pg.PoolClient, collector: string, error: string | null) {
  await db.query(
    `update private.ops_collector_state
     set last_success_at = case when $2::text is null then now() else last_success_at end, last_error = $2
     where collector = $1`,
    [collector, error ? error.slice(0, 500) : null],
  )
}

export async function sendAlertEmails(db: pg.PoolClient, notices: AlertNotice[]) {
  if (!notices.length) return 0
  const config = loadEmailConfig()
  const service = createEmailService(config)
  if (!service.enabled) return 0
  const { rows } = await db.query<{ email: string }>(
    `select u.email from private.admin_users a join auth.users u on u.id = a.user_id where u.email is not null`,
  )
  const adminHost = process.env.ADMIN_HOST?.trim()
  const mail = opsAlertEmail({ adminBaseUrl: adminHost ? `https://${adminHost}` : config.appBaseUrl, alerts: notices })
  const bucket = new Date().toISOString().slice(0, 13)
  const key = notices.map((n) => `${n.ruleKey}.${n.level}`).sort().join('_').slice(0, 120).replace(/[^A-Za-z0-9_.-]/g, '')
  let sent = 0
  for (const row of rows) {
    const result = await service.send({
      category: mail.category,
      template: mail.template,
      to: row.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `hilm/ops-alert/${bucket}/${key}/${createHash('sha256').update(row.email).digest('hex').slice(0, 16)}`,
    })
    if (result.ok) sent += 1
  }
  return sent
}

async function handler(request: Request) {
  const auth = authorizeCronRequest(request, process.env.CRON_SECRET)
  if (!auth.ok) return json({ error: auth.error }, auth.status)
  if (!databaseUrl()) return json({ error: 'DATABASE_URL is not configured' }, 500)

  const started = Date.now()
  const remaining = () => BUDGET_MS - (Date.now() - started)
  const report: Record<string, unknown> = {}
  let client: pg.PoolClient | null = null
  let failure: unknown
  try {
    client = await acquireDb()

    try {
      report.reminders = await runTaskReminders(client, await loadReminderSecrets(client))
    } catch (error) {
      report.reminders = { error: error instanceof Error ? error.message.slice(0, 120) : 'failed' }
    }

    try {
      report.email = await drainEmail(client, Math.min(10_000, Math.max(0, remaining() - 12_000)))
    } catch {
      report.email = { error: 'dispatch_failed' }
    }

    if (remaining() > 12_000 && (await claimJob(client, 'lifecycle'))) {
      try {
        const lifecycle = await runStorageLifecycle(client, storageProviders(), {
          trigger: 'schedule',
          budgetMs: Math.min(9_000, remaining() - 6_000),
        })
        report.lifecycle = lifecycle
        const notices = await evaluateAlerts(client)
        report.alerts = { notices: notices.length, emailed: await sendAlertEmails(client, notices) }
        await finishJob(client, 'lifecycle', lifecycle.status === 'failed' ? (lifecycle.error ?? 'failed') : null)
      } catch (error) {
        await finishJob(client, 'lifecycle', error instanceof Error ? error.message : 'failed')
        report.lifecycle = { error: 'failed' }
      }
    }

    if (remaining() > 9_000 && (await claimJob(client, 'metrics'))) {
      const daily = await claimJob(client, 'daily')
      try {
        const collected = await runMetricsCollection(client, {
          env: process.env,
          openRouterKey: loadOpenRouterKey,
          includeDaily: daily,
          listBlobs: async () => {
            const store = getStore({ name: EMAIL_ASSET_STORE })
            const { blobs } = await store.list()
            const sized: Array<{ key: string; size: number | null }> = []
            for (const blob of blobs.slice(0, 100)) {
              const data = await store.get(blob.key, { type: 'arrayBuffer' })
              sized.push({ key: blob.key, size: data ? data.byteLength : null })
            }
            if (blobs.length > 100) sized.push({ key: '…', size: null })
            return sized
          },
        })
        report.metrics = collected
        await finishJob(client, 'metrics', collected.errors.length ? collected.errors.join('; ') : null)
      } catch (error) {
        await finishJob(client, 'metrics', error instanceof Error ? error.message : 'failed')
        report.metrics = { error: 'failed' }
      }
      if (daily) {
        try {
          const drift = (await client.query<{ n: number }>(`select private.storage_reconcile_usage() as n`)).rows[0]?.n
          const pruned = await pruneSnapshots(client)
          await client.query(`delete from private.storage_object_deletions where status = 'done' and processed_at < now() - interval '90 days'`)
          report.daily = { usageDriftFixed: drift, snapshotsPruned: pruned }
          await finishJob(client, 'daily', null)
        } catch (error) {
          await finishJob(client, 'daily', error instanceof Error ? error.message : 'failed')
        }
      }
    }

    return json({ ok: true, ms: Date.now() - started, ...report })
  } catch (error) {
    failure = error
    console.error(JSON.stringify({ scope: 'scheduler', outcome: 'failed', code: (error as { code?: string })?.code ?? 'unknown' }))
    return json({ error: 'scheduler_failed' }, 500)
  } finally {
    client?.release(isRetryableDbError(failure) ? (failure as Error) : undefined)
  }
}

export default instrumented('scheduler', handler)

export const config: Config = {
  schedule: '* * * * *',
}
