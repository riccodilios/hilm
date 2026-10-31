/** PostgREST returns at most this many rows per request (Supabase "Max rows" setting). */
export const POSTGREST_MAX_ROWS = 1000

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>

/**
 * Reads every row of a query, page by page, ordered by the immutable `id` column (keyset
 * pagination: rows inserted, updated or deleted between pages are never skipped or repeated).
 * `page` must apply `.order('id').limit(size)` and, when `afterId` is set, `.gt('id', afterId)`.
 * Sort the result for display afterwards.
 */
export async function fetchAllByKeyset<T extends { id: string }>(
  page: (afterId: string | null, size: number) => Page<T>,
  size = POSTGREST_MAX_ROWS,
): Promise<T[]> {
  const rows: T[] = []
  let afterId: string | null = null
  for (;;) {
    const { data, error } = await page(afterId, size)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < size) return rows
    afterId = batch[batch.length - 1]!.id
  }
}

/** Newest first by a timestamp column, ties broken by id so the order is stable. */
export function sortByTimestampDesc<T extends { id: string }>(rows: T[], key: keyof T): T[] {
  return rows.sort((a, b) => {
    const left = String(a[key] ?? '')
    const right = String(b[key] ?? '')
    if (left !== right) return left < right ? 1 : -1
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}
