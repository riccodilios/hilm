import { describe, expect, it } from 'vitest'
import type { Queryable } from './lifecycle.ts'
import { migrateFile } from './migrate.ts'
import { sha256Hex, type StorageProvider } from './provider.ts'

function memoryProvider(name: 'supabase' | 'r2', opts: { corrupt?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>()
  const provider: StorageProvider = {
    name,
    async deleteObjects(bucket, keys) {
      for (const key of keys) objects.delete(`${bucket}/${key}`)
      return { deleted: keys, failed: [] }
    },
    async headObject(bucket, key) {
      const body = objects.get(`${bucket}/${key}`)
      return body ? { size: body.byteLength, contentType: null } : null
    },
    async createSignedDownloadUrl() {
      return ''
    },
    async getObject(bucket, key) {
      const body = objects.get(`${bucket}/${key}`)
      if (!body) throw new Error('missing')
      return opts.corrupt ? body.map((b) => b ^ 1) : body
    },
    async putObject(bucket, key, body) {
      objects.set(`${bucket}/${key}`, body)
    },
  }
  return { provider, objects }
}

function fakeRegistry(row: Record<string, unknown>) {
  const updates: unknown[][] = []
  const db = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.trim().startsWith('select')) return { rows: [row] }
      if (sql.trim().startsWith('update')) {
        updates.push(params)
        return { rows: [{ id: row.id }] }
      }
      return { rows: [] }
    },
  }
  return { db: db as unknown as Queryable, updates }
}

const body = new TextEncoder().encode('hilm migration test')

describe('provider migration', () => {
  it('copies, verifies size and checksum, then points the registry at the new copy', async () => {
    const source = memoryProvider('supabase')
    const target = memoryProvider('r2')
    source.objects.set('attachments/a/b.txt', body)
    const { db, updates } = fakeRegistry({ id: 'f1', provider: 'supabase', bucket: 'attachments', object_key: 'a/b.txt', size_bytes: body.byteLength, status: 'active', checksum_sha256: null })
    const result = await migrateFile(db, { supabase: source.provider, r2: target.provider }, 'f1', { provider: 'r2', bucket: 'hilm' }, { rollbackDays: 30 })
    expect(result).toMatchObject({ ok: true, bytes: body.byteLength, checksum: await sha256Hex(body) })
    expect(target.objects.get('hilm/a/b.txt')).toEqual(body)
    expect(source.objects.has('attachments/a/b.txt')).toBe(true)
    expect(updates[0]).toEqual(['f1', 'r2', 'hilm', await sha256Hex(body), 30, 'supabase', 'attachments'])
  })

  it('refuses when the source does not match the registry', async () => {
    const source = memoryProvider('supabase')
    source.objects.set('attachments/a/b.txt', body)
    const { db, updates } = fakeRegistry({ id: 'f1', provider: 'supabase', bucket: 'attachments', object_key: 'a/b.txt', size_bytes: 3, status: 'active' })
    const result = await migrateFile(db, { supabase: source.provider, r2: memoryProvider('r2').provider }, 'f1', { provider: 'r2', bucket: 'hilm' }, { rollbackDays: 30 })
    expect(result).toEqual({ ok: false, fileId: 'f1', reason: 'source_size_mismatch' })
    expect(updates).toHaveLength(0)
  })

  it('removes a corrupted copy and leaves the registry unchanged', async () => {
    const source = memoryProvider('supabase')
    const target = memoryProvider('r2', { corrupt: true })
    source.objects.set('attachments/a/b.txt', body)
    const { db, updates } = fakeRegistry({ id: 'f1', provider: 'supabase', bucket: 'attachments', object_key: 'a/b.txt', size_bytes: body.byteLength, status: 'active' })
    const result = await migrateFile(db, { supabase: source.provider, r2: target.provider }, 'f1', { provider: 'r2', bucket: 'hilm' }, { rollbackDays: 30 })
    expect(result).toMatchObject({ ok: false, reason: 'destination_checksum_mismatch' })
    expect(target.objects.size).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('only migrates active files', async () => {
    const { db } = fakeRegistry({ id: 'f1', provider: 'supabase', bucket: 'attachments', object_key: 'k', size_bytes: 1, status: 'quarantined' })
    const result = await migrateFile(db, {}, 'f1', { provider: 'r2', bucket: 'hilm' }, { rollbackDays: 30 })
    expect(result).toEqual({ ok: false, fileId: 'f1', reason: 'status_quarantined' })
  })
})
