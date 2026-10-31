import pg from 'pg'

/**
 * One small connection pool per function instance, reused across warm invocations.
 * DATABASE_POOLER_URL (Supabase Supavisor, transaction mode) is preferred so many concurrent
 * function instances share a bounded set of Postgres connections; DATABASE_URL is the fallback.
 */
const POOL_MAX = 3
const RETRYABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '08000',
  '08003',
  '08006',
])

let pool: pg.Pool | null = null
let poolUrl: string | null = null

export function databaseUrl(env: Record<string, string | undefined> = process.env) {
  return env.DATABASE_POOLER_URL?.trim() || env.DATABASE_URL?.trim() || null
}

function getPool(url: string) {
  if (pool && poolUrl === url) return pool
  pool = new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
  })
  poolUrl = url
  // An idle client dropped by the server must not crash the function.
  pool.on('error', (error) => console.error(JSON.stringify({ msg: 'db_pool_error', code: (error as { code?: string }).code })))
  return pool
}

export function isRetryableDbError(error: unknown) {
  const code = (error as { code?: string } | null)?.code
  return Boolean(code && RETRYABLE_CODES.has(code))
}

/** A pooled client; call release() when done (pass the error to discard a broken connection). */
export async function acquireDb(url = databaseUrl()): Promise<pg.PoolClient> {
  if (!url) throw new Error('DATABASE_URL is not configured')
  try {
    return await getPool(url).connect()
  } catch (error) {
    if (!isRetryableDbError(error)) throw error
    // One fresh pool and one retry: covers a dropped pool or a pooler restart.
    await resetDbPool()
    await new Promise((resolve) => setTimeout(resolve, 250))
    return getPool(url).connect()
  }
}

export async function withDb<T>(fn: (db: pg.PoolClient) => Promise<T>, url = databaseUrl()): Promise<T> {
  const client = await acquireDb(url)
  let failure: unknown
  try {
    return await fn(client)
  } catch (error) {
    failure = error
    throw error
  } finally {
    client.release(isRetryableDbError(failure) ? (failure as Error) : undefined)
  }
}

export async function resetDbPool() {
  const current = pool
  pool = null
  poolUrl = null
  await current?.end().catch(() => undefined)
}
