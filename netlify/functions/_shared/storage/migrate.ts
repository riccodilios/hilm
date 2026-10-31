import type { Queryable } from './lifecycle.ts'
import { providerFor, sha256Hex, StorageProviderError, type ProviderRegistry } from './provider.ts'

export type MigrationTarget = { provider: 'supabase' | 'r2'; bucket: string }

export type MigrationOutcome =
  | { ok: true; fileId: string; bytes: number; checksum: string }
  | { ok: false; fileId: string; reason: string }

/**
 * Moves one registered file to another provider:
 * copy → verify size and checksum → point the registry at the new copy (previous location kept)
 * → the old copy is deleted by the lifecycle worker only after `rollbackDays`.
 * Feature tables are not touched: downloads resolve through the registry.
 */
export async function migrateFile(
  db: Queryable,
  providers: ProviderRegistry,
  fileId: string,
  target: MigrationTarget,
  options: { rollbackDays: number },
): Promise<MigrationOutcome> {
  const { rows } = await db.query(
    `select id, provider, bucket, object_key, size_bytes, mime_type, checksum_sha256, status
     from public.storage_files where id = $1`,
    [fileId],
  )
  const file = rows[0] as
    | { id: string; provider: string; bucket: string; object_key: string; size_bytes: string | number; mime_type: string | null; checksum_sha256: string | null; status: string }
    | undefined
  if (!file) return { ok: false, fileId, reason: 'not_found' }
  if (file.status !== 'active') return { ok: false, fileId, reason: `status_${file.status}` }
  if (file.provider === target.provider && file.bucket === target.bucket) return { ok: false, fileId, reason: 'already_there' }

  const source = providerFor(providers, file.provider)
  const destination = providerFor(providers, target.provider)
  const bytes = await source.getObject(file.bucket, file.object_key)
  const checksum = await sha256Hex(bytes)
  if (Number(file.size_bytes) !== bytes.byteLength) return { ok: false, fileId, reason: 'source_size_mismatch' }
  if (file.checksum_sha256 && file.checksum_sha256 !== checksum) return { ok: false, fileId, reason: 'source_checksum_mismatch' }

  await destination.putObject(target.bucket, file.object_key, bytes, file.mime_type)
  const copied = await destination.headObject(target.bucket, file.object_key)
  if (!copied || copied.size !== bytes.byteLength) {
    await destination.deleteObjects(target.bucket, [file.object_key]).catch(() => undefined)
    return { ok: false, fileId, reason: 'destination_verification_failed' }
  }
  const roundTrip = await sha256Hex(await destination.getObject(target.bucket, file.object_key))
  if (roundTrip !== checksum) {
    await destination.deleteObjects(target.bucket, [file.object_key]).catch(() => undefined)
    return { ok: false, fileId, reason: 'destination_checksum_mismatch' }
  }

  const updated = await db.query(
    `update public.storage_files
     set provider = $2, bucket = $3, checksum_sha256 = $4, migrated_at = now(),
         previous_location = jsonb_build_object('provider', provider, 'bucket', bucket, 'object_key', object_key,
           'rollback_until', now() + make_interval(days => $5))
     where id = $1 and provider = $6 and bucket = $7 and status = 'active'
     returning id`,
    [fileId, target.provider, target.bucket, checksum, options.rollbackDays, file.provider, file.bucket],
  )
  if (!updated.rows.length) {
    await destination.deleteObjects(target.bucket, [file.object_key]).catch(() => undefined)
    return { ok: false, fileId, reason: 'registry_changed_during_copy' }
  }
  return { ok: true, fileId, bytes: bytes.byteLength, checksum }
}

export { StorageProviderError }
