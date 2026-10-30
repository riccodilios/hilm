/**
 * Admin portal gate. A request is served only when ALL of these hold:
 *  1. it arrives on the admin host (ADMIN_HOST) — anything else gets a plain 404;
 *  2. state-changing requests carry Origin: https://ADMIN_HOST (CSRF);
 *  3. a valid Supabase session token whose assurance level is aal2 (password + TOTP);
 *  4. the user is the single row in private.admin_users;
 *  5. the client network is approved (the first verified network registers itself);
 *  6. sensitive actions also need a TOTP verification from the last 10 minutes.
 * Denials and actions are written to the append-only private.admin_audit_log.
 */
import type pg from 'pg'
import { clientIp, networkPrefix } from './network.ts'

type Db = Pick<pg.Client, 'query'>

export type AdminUser = { id: string; email: string | null }

export type AdminContext = {
  userId: string
  email: string | null
  network: string
  networkAllowed: boolean
  networkRegistered: boolean
}

export type GuardDeps = {
  adminHost: string | null
  db: Db
  getUser: (token: string) => Promise<AdminUser | null>
  now?: () => number
}

export const SENSITIVE_MFA_MAX_AGE_S = 10 * 60

export const adminJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
    },
  })

type Claims = { sub?: string; aal?: string; amr?: Array<{ method?: string; timestamp?: number }>; exp?: number }

/** Payload of a token that Supabase has already validated (getUser); never trusted on its own. */
export function decodeClaims(token: string): Claims | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Claims
  } catch {
    return null
  }
}

export function lastMfaAt(claims: Claims): number | null {
  const times = (claims.amr ?? [])
    .filter((m) => m.method === 'totp' && typeof m.timestamp === 'number')
    .map((m) => m.timestamp!)
  return times.length ? Math.max(...times) : null
}

export async function audit(
  db: Db,
  entry: { adminId: string | null; action: string; target?: string | null; network?: string | null; details?: Record<string, unknown> },
) {
  await db
    .query(
      `insert into private.admin_audit_log (admin_id, action, target, network, details) values ($1, $2, $3, $4, $5::jsonb)`,
      [entry.adminId, entry.action.slice(0, 64), entry.target?.slice(0, 200) ?? null, entry.network ?? null, JSON.stringify(entry.details ?? {})],
    )
    .catch(() => undefined)
}

export async function authorizeAdmin(
  request: Request,
  deps: GuardDeps,
  opts: { allowUnknownNetwork?: boolean; sensitive?: boolean } = {},
): Promise<{ ok: true; ctx: AdminContext } | { ok: false; response: Response }> {
  const deny = (status: number, error: string) => ({ ok: false as const, response: adminJson(status, { error }) })
  const host = deps.adminHost?.toLowerCase()
  if (!host || new URL(request.url).host.toLowerCase() !== host) return deny(404, 'not_found')

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (request.headers.get('origin') !== `https://${host}`) return deny(403, 'bad_origin')
  }

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return deny(401, 'unauthorized')
  const user = await deps.getUser(token)
  const claims = user ? decodeClaims(token) : null
  if (!user || !claims || claims.sub !== user.id) return deny(401, 'unauthorized')

  const network = networkPrefix(clientIp(request))

  const admin = await deps.db.query<{ ok: boolean }>(`select true as ok from private.admin_users where user_id = $1`, [user.id])
  if (!admin.rows.length) {
    await audit(deps.db, { adminId: null, action: 'denied_not_admin', target: user.id, network })
    return deny(403, 'forbidden')
  }
  if (claims.aal !== 'aal2') return deny(403, 'mfa_required')
  if (!network) return deny(403, 'network_unknown')

  const nets = await deps.db.query<{ prefix: string }>(`select prefix from private.admin_allowed_networks`)
  let networkAllowed = nets.rows.some((r) => r.prefix === network)
  let networkRegistered = false
  if (!nets.rows.length) {
    // Trust on first use: the first password + TOTP sign-in pins the admin's network.
    await deps.db.query(
      `insert into private.admin_allowed_networks (prefix, label) values ($1, 'first sign-in') on conflict do nothing`,
      [network],
    )
    await audit(deps.db, { adminId: user.id, action: 'network_registered', target: network, network })
    networkAllowed = true
    networkRegistered = true
  } else if (networkAllowed) {
    await deps.db.query(`update private.admin_allowed_networks set last_seen_at = now() where prefix = $1`, [network])
  } else if (!opts.allowUnknownNetwork) {
    await audit(deps.db, { adminId: user.id, action: 'denied_network', target: network, network })
    return deny(403, 'network_not_allowed')
  }

  if (opts.sensitive) {
    const at = lastMfaAt(claims)
    const now = Math.floor((deps.now?.() ?? Date.now()) / 1000)
    if (!at || now - at > SENSITIVE_MFA_MAX_AGE_S) return deny(401, 'reauth_required')
  }

  return { ok: true, ctx: { userId: user.id, email: user.email, network, networkAllowed, networkRegistered } }
}
