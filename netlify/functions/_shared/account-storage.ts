/**
 * Removes a user's personal files (task attachments, meeting audio) through the Storage API with the
 * user's own token, so Storage policies decide what may be removed. Shared workspace files stay with
 * the workspace. Paths that cannot be removed here are left to private.storage_object_deletions.
 */
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

const PERSONAL_BUCKETS = ['attachments', 'meeting-audio'] as const
const BATCH = 100

export type RemovedObject = { bucket: string; name: string }

export async function listPersonalObjects(db: Db, userId: string): Promise<RemovedObject[]> {
  const { rows } = await db.query(
    `select bucket_id, name from storage.objects
     where bucket_id = any($1::text[]) and name like $2
     order by bucket_id, name`,
    [PERSONAL_BUCKETS, `${userId}/%`],
  )
  return rows.map((row) => ({ bucket: String(row.bucket_id), name: String(row.name) }))
}

export async function removeObjectsAsUser(
  input: { supabaseUrl: string; anonKey: string; token: string; objects: RemovedObject[] },
  fetchImpl: typeof fetch = fetch,
): Promise<RemovedObject[]> {
  const removed: RemovedObject[] = []
  for (const bucket of PERSONAL_BUCKETS) {
    const names = input.objects.filter((object) => object.bucket === bucket).map((object) => object.name)
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH)
      const response = await fetchImpl(`${input.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${input.token}`,
          apikey: input.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: batch }),
      })
      if (!response.ok) continue
      const deleted = (await response.json().catch(() => [])) as Array<{ name?: string }>
      for (const item of deleted) if (item.name) removed.push({ bucket, name: item.name })
    }
  }
  return removed
}

export async function markObjectsRemoved(db: Db, objects: RemovedObject[]) {
  if (!objects.length) return
  await db.query(
    `insert into private.storage_object_deletions (bucket_id, object_name, reason, processed_at)
     select b, n, 'account deleted', now() from unnest($1::text[], $2::text[]) as x(b, n)
     on conflict (bucket_id, object_name) do update set processed_at = now()`,
    [objects.map((object) => object.bucket), objects.map((object) => object.name)],
  )
}
