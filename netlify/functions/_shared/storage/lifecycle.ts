import type pg from 'pg'
import { providerFor, StorageProviderError, type ProviderRegistry } from './provider.ts'

export type Queryable = Pick<pg.ClientBase, 'query'>

type BeginResult =
  | { skipped: true; reason: string }
  | {
      skipped: false
      run_id: string
      lease_owner: string
      mode: 'off' | 'dry_run' | 'quarantine' | 'enforce'
      max_deletions_per_run: number
      max_bytes_per_run: number
    }

type ClaimedDeletion = {
  id: string
  provider: string
  bucket_id: string
  object_name: string
  file_id: string | null
  attempts: number
  size_bytes: string | number
}

export type LifecycleResult = {
  skipped?: string
  runId?: string
  mode?: string
  status?: 'completed' | 'failed'
  stats?: Record<string, unknown>
  error?: string
}

const BATCH = 50

/**
 * One lifecycle run: SQL decides what is due (inventory, warnings, quarantine, purge requests,
 * audio disposal) and the queue is drained through the storage providers. Only `enforce` deletes
 * objects. Every result is recorded and confirmed in Postgres; a provider saying "ok" is not
 * enough for a file to count as deleted.
 */
export async function runStorageLifecycle(
  db: Queryable,
  providers: ProviderRegistry,
  options: { trigger: string; budgetMs: number; now?: () => number },
): Promise<LifecycleResult> {
  const now = options.now ?? Date.now
  const deadline = now() + options.budgetMs
  const begin = (await db.query<{ r: BeginResult }>(`select private.storage_lifecycle_begin($1) as r`, [options.trigger])).rows[0]?.r
  if (!begin) return { skipped: 'no_settings' }
  if (begin.skipped) return { skipped: begin.reason }

  const stats: Record<string, unknown> = {}
  let status: 'completed' | 'failed' = 'completed'
  let error: string | undefined
  try {
    const step = (await db.query<{ s: Record<string, unknown> }>(`select private.storage_lifecycle_step($1) as s`, [begin.run_id])).rows[0]?.s
    Object.assign(stats, step ?? {})

    if (begin.mode === 'enforce' && !step?.circuit_breaker) {
      const drained = await drainDeletionQueue(db, providers, {
        runId: begin.run_id,
        limit: begin.max_deletions_per_run,
        maxBytes: Number(begin.max_bytes_per_run),
        deadline,
        now,
      })
      Object.assign(stats, { queue: drained })
    }
  } catch (caught) {
    status = 'failed'
    error = caught instanceof Error ? caught.message : 'lifecycle step failed'
  }

  await db.query(`select private.storage_lifecycle_finish($1, $2, $3, $4::jsonb, $5)`, [
    begin.run_id,
    begin.lease_owner,
    status,
    JSON.stringify(stats),
    error ?? null,
  ])
  return { runId: begin.run_id, mode: begin.mode, status, stats, error }
}

export async function drainDeletionQueue(
  db: Queryable,
  providers: ProviderRegistry,
  options: { runId: string | null; limit: number; maxBytes: number; deadline: number; now?: () => number },
) {
  const now = options.now ?? Date.now
  const outcome = { claimed: 0, deleted: 0, retry: 0, failed: 0, skipped: 0 }
  let remaining = options.limit
  let bytesLeft = options.maxBytes

  while (remaining > 0 && bytesLeft > 0 && now() < options.deadline - 3_000) {
    const { rows } = await db.query<ClaimedDeletion>(
      `select * from private.storage_claim_deletions($1, $2)`,
      [Math.min(BATCH, remaining), bytesLeft],
    )
    if (!rows.length) break
    outcome.claimed += rows.length
    remaining -= rows.length
    bytesLeft -= rows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0)

    const groups = new Map<string, ClaimedDeletion[]>()
    for (const row of rows) {
      const key = `${row.provider}\u0000${row.bucket_id}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }

    for (const items of groups.values()) {
      const { provider: providerName, bucket_id: bucket } = items[0]
      let failures = new Map<string, string>()
      let providerError: string | null = null
      const recordedIds = new Set<string>()
      try {
        const provider = providerFor(providers, providerName)
        const result = await provider.deleteObjects(bucket, items.map((item) => item.object_name))
        failures = new Map(result.failed.map((f) => [f.key, f.error]))
        for (const item of items) {
          if (failures.has(item.object_name)) continue
          let absent = providerName === 'supabase'
          if (!absent) {
            // Providers without a Postgres catalogue: confirm with a fresh existence check.
            absent = (await provider.headObject(bucket, item.object_name).catch(() => undefined)) === null
          }
          recordedIds.add(item.id)
          tally(outcome, await record(db, options.runId, item.id, true, null, absent))
        }
      } catch (caught) {
        providerError = caught instanceof StorageProviderError ? `${caught.code}: ${caught.message}` : caught instanceof Error ? caught.message : 'provider error'
      }
      for (const item of items) {
        if (recordedIds.has(item.id)) continue
        const message = providerError ?? failures.get(item.object_name)
        if (message === undefined) continue
        tally(outcome, await record(db, options.runId, item.id, false, message, false))
      }
    }
  }
  return outcome
}

async function record(db: Queryable, runId: string | null, id: string, ok: boolean, error: string | null, absent: boolean) {
  const { rows } = await db.query<{ r: string }>(
    `select private.storage_record_deletion($1, $2, $3, $4, $5) as r`,
    [id, runId, ok, error, absent],
  )
  return rows[0]?.r ?? 'skipped'
}

function tally(outcome: { deleted: number; retry: number; failed: number; skipped: number }, result: string) {
  if (result === 'deleted') outcome.deleted += 1
  else if (result === 'retry') outcome.retry += 1
  else if (result === 'failed') outcome.failed += 1
  else outcome.skipped += 1
}

/** Retry delay used by private.storage_record_deletion, mirrored for tests and the admin UI. */
export function deletionBackoffMinutes(attempts: number) {
  return Math.min(24 * 60, 5 * 2 ** attempts)
}
