/** Minimal pg stand-in for tests: the first handler whose pattern matches the SQL answers. */
import type pg from 'pg'

type Handler = [RegExp, (params: unknown[]) => { rows?: unknown[]; rowCount?: number }]

export function fakeDb(handlers: Handler[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    const handler = handlers.find(([re]) => re.test(sql))
    const result = handler ? handler[1](params) : {}
    const rows = result.rows ?? []
    return { rows, rowCount: result.rowCount ?? rows.length }
  }
  return { calls, query } as unknown as Pick<pg.Client, 'query'> & { calls: typeof calls }
}
