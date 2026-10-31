import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

/** Reads .env without printing anything. */
export function loadEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), '.env')
  const fromFile = fs.existsSync(file)
    ? Object.fromEntries(
        fs
          .readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith('#') && line.includes('='))
          .map((line) => {
            const i = line.indexOf('=')
            return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
          }),
      )
    : {}
  return { ...fromFile, ...(process.env as Record<string, string>) }
}

export const env = loadEnv()
export const DATABASE_URL = env.DATABASE_POOLER_URL || env.DATABASE_URL

export function newClient() {
  if (!DATABASE_URL) throw new Error('Security tests need DATABASE_URL or DATABASE_POOLER_URL')
  return new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
}

export type Outcome<T = pg.QueryResult> = { ok: true; result: T } | { ok: false; error: Error & { code?: string } }

let savepointSeq = 0

/**
 * Runs `fn` inside a savepoint, optionally as an authenticated user (JWT claims + role), and rolls
 * the savepoint back on error so the surrounding test transaction stays usable.
 */
export async function attempt<T>(
  client: pg.Client,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<Outcome<T>> {
  const name = `sp_${(savepointSeq += 1)}`
  await client.query(`savepoint ${name}`)
  try {
    if (userId) {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
      ])
      await client.query('set local role authenticated')
    }
    const result = await fn()
    if (userId) {
      await client.query('reset role')
      await client.query(`select set_config('request.jwt.claims', '', true)`)
    }
    await client.query(`release savepoint ${name}`)
    return { ok: true, result }
  } catch (error) {
    await client.query(`rollback to savepoint ${name}`)
    await client.query('reset role').catch(() => undefined)
    return { ok: false, error: error as Error & { code?: string } }
  }
}

/** Query as a user; throws if the database refuses. */
export async function asUser(client: pg.Client, userId: string, sql: string, params: unknown[] = []) {
  const outcome = await attempt(client, userId, () => client.query(sql, params))
  if (!outcome.ok) throw outcome.error
  return outcome.result
}

/** Query as a user and return the refusal (or null if it unexpectedly succeeded). */
export async function refusedAs(client: pg.Client, userId: string, sql: string, params: unknown[] = []) {
  const outcome = await attempt(client, userId, () => client.query(sql, params))
  return outcome.ok ? null : outcome.error
}

export async function idsAs(client: pg.Client, userId: string, sql: string, params: unknown[] = []) {
  const { rows } = await asUser(client, userId, sql, params)
  return rows.map((row) => String(row.id)).sort()
}

/** Wraps a client so code that issues begin/commit/rollback nests inside the test transaction. */
export function nestedTransactionClient(client: pg.Client) {
  let depth = 0
  return {
    async query(sql: string, params?: unknown[]) {
      const verb = sql.trim().toLowerCase()
      if (verb === 'begin') {
        depth += 1
        return client.query(`savepoint nested_${depth}`)
      }
      if (verb === 'commit') {
        const result = await client.query(`release savepoint nested_${depth}`)
        depth -= 1
        return result
      }
      if (verb === 'rollback') {
        const result = await client.query(`rollback to savepoint nested_${depth}`)
        depth -= 1
        return result
      }
      return client.query(sql, params as never)
    },
  }
}

export const uid = () => randomUUID()

export async function createAuthUser(client: pg.Client, id: string, email: string, password?: string) {
  await client.query(
    `insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, encrypted_password,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(),
       case when $3::text is null then null else extensions.crypt($3, extensions.gen_salt('bf')) end,
       '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', $4::text), now(), now())`,
    [id, email, password ?? null, email.split('@')[0]],
  )
  if (password) {
    await client.query(
      `insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
       values (gen_random_uuid(), $1, $1::text, 'email', jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true), now(), now(), now())`,
      [id, email],
    )
  }
}

export function testEmail(label: string) {
  return `sec-test+${label}-${randomUUID().slice(0, 8)}@example.invalid`
}
