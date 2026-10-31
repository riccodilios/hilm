import { describe, expect, it } from 'vitest'
import { deletionBackoffMinutes, drainDeletionQueue, runStorageLifecycle, type Queryable } from './lifecycle.ts'
import { StorageProviderError, type StorageProvider } from './provider.ts'

type Item = { id: string; provider: string; bucket_id: string; object_name: string; file_id: string | null; attempts: number; size_bytes: number }

function fakeDb(items: Item[], opts: { mode?: string; circuit?: boolean } = {}) {
  const recorded: Array<{ id: string; ok: boolean; error: string | null; absent: boolean }> = []
  const calls: string[] = []
  let pending = [...items]
  const db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '))
      if (sql.includes('storage_lifecycle_begin')) {
        return { rows: [{ r: { skipped: false, run_id: 'run', lease_owner: 'lease', mode: opts.mode ?? 'enforce', max_deletions_per_run: 100, max_bytes_per_run: 10_000 } }] }
      }
      if (sql.includes('storage_lifecycle_step')) return { rows: [{ s: opts.circuit ? { circuit_breaker: true } : { quarantined: 0 } }] }
      if (sql.includes('storage_claim_deletions')) {
        const [limit] = params as [number, number]
        const batch = pending.slice(0, limit)
        pending = pending.slice(limit)
        return { rows: batch }
      }
      if (sql.includes('storage_record_deletion')) {
        const [id, , ok, error, absent] = params as [string, string, boolean, string | null, boolean]
        recorded.push({ id, ok, error, absent })
        return { rows: [{ r: ok ? 'deleted' : 'retry' }] }
      }
      return { rows: [] }
    },
  }
  return { db: db as unknown as Queryable, recorded, calls }
}

function provider(name: 'supabase' | 'r2', behaviour: { fail?: Set<string>; throws?: boolean; present?: Set<string> } = {}): StorageProvider {
  return {
    name,
    async deleteObjects(_bucket, keys) {
      if (behaviour.throws) throw new StorageProviderError(name, 'unavailable', 'down')
      return {
        deleted: keys.filter((k) => !behaviour.fail?.has(k)),
        failed: keys.filter((k) => behaviour.fail?.has(k)).map((key) => ({ key, error: 'nope' })),
      }
    },
    async headObject(_bucket, key) {
      return behaviour.present?.has(key) ? { size: 1, contentType: null } : null
    },
    async createSignedDownloadUrl() {
      return ''
    },
    async getObject() {
      return new Uint8Array()
    },
    async putObject() {},
  }
}

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  provider: 'supabase',
  bucket_id: 'attachments',
  object_name: `k${id}`,
  file_id: `f${id}`,
  attempts: 0,
  size_bytes: 10,
  ...extra,
})

describe('storage lifecycle runner', () => {
  it('deletes through the provider and records every result for confirmation', async () => {
    const { db, recorded } = fakeDb([item('1'), item('2')])
    const result = await runStorageLifecycle(db, { supabase: provider('supabase') }, { trigger: 'test', budgetMs: 20_000 })
    expect(result.status).toBe('completed')
    expect(recorded.map((r) => [r.id, r.ok])).toEqual([
      ['1', true],
      ['2', true],
    ])
  })

  it('records provider failures for retry instead of assuming deletion', async () => {
    const { db, recorded } = fakeDb([item('1'), item('2')])
    await drainDeletionQueue(db, { supabase: provider('supabase', { fail: new Set(['k2']) }) }, { runId: 'r', limit: 10, maxBytes: 1000, deadline: Date.now() + 20_000 })
    expect(recorded).toEqual([
      { id: '1', ok: true, error: null, absent: true },
      { id: '2', ok: false, error: 'nope', absent: false },
    ])
  })

  it('a provider outage marks the whole batch for retry', async () => {
    const { db, recorded } = fakeDb([item('1'), item('2')])
    const outcome = await drainDeletionQueue(db, { supabase: provider('supabase', { throws: true }) }, { runId: 'r', limit: 10, maxBytes: 1000, deadline: Date.now() + 20_000 })
    expect(recorded.every((r) => !r.ok && r.error?.includes('unavailable'))).toBe(true)
    expect(outcome.retry).toBe(2)
  })

  it('an unconfigured provider never counts as deleted', async () => {
    const { db, recorded } = fakeDb([item('1', { provider: 'r2' })])
    await drainDeletionQueue(db, { supabase: provider('supabase') }, { runId: 'r', limit: 10, maxBytes: 1000, deadline: Date.now() + 20_000 })
    expect(recorded[0]).toMatchObject({ ok: false })
  })

  it('other providers must confirm absence with a fresh check', async () => {
    const { db, recorded } = fakeDb([item('1', { provider: 'r2', object_name: 'gone' }), item('2', { provider: 'r2', object_name: 'still' })])
    await drainDeletionQueue(db, { r2: provider('r2', { present: new Set(['still']) }) }, { runId: 'r', limit: 10, maxBytes: 1000, deadline: Date.now() + 20_000 })
    expect(recorded.map((r) => r.absent)).toEqual([true, false])
  })

  it('does not delete in dry-run or quarantine mode, nor when the circuit breaker trips', async () => {
    for (const setup of [{ mode: 'dry_run' }, { mode: 'quarantine' }, { mode: 'enforce', circuit: true }]) {
      const { db, recorded, calls } = fakeDb([item('1')], setup)
      await runStorageLifecycle(db, { supabase: provider('supabase') }, { trigger: 'test', budgetMs: 20_000 })
      expect(recorded).toHaveLength(0)
      expect(calls.some((c) => c.includes('storage_claim_deletions'))).toBe(false)
    }
  })

  it('stops at the per-run cap and the time budget', async () => {
    const many = Array.from({ length: 30 }, (_, i) => item(String(i)))
    const capped = fakeDb(many)
    await drainDeletionQueue(capped.db, { supabase: provider('supabase') }, { runId: 'r', limit: 5, maxBytes: 1e9, deadline: Date.now() + 20_000 })
    expect(capped.recorded).toHaveLength(5)
    const late = fakeDb(many)
    await drainDeletionQueue(late.db, { supabase: provider('supabase') }, { runId: 'r', limit: 30, maxBytes: 1e9, deadline: Date.now() + 1_000 })
    expect(late.recorded).toHaveLength(0)
  })

  it('backs off exponentially up to a day', () => {
    expect(deletionBackoffMinutes(0)).toBe(5)
    expect(deletionBackoffMinutes(3)).toBe(40)
    expect(deletionBackoffMinutes(20)).toBe(24 * 60)
  })
})
