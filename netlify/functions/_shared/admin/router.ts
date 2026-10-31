/**
 * /api/admin/* router. Every route goes through authorizeAdmin; destructive routes are
 * "sensitive" (fresh TOTP within 10 minutes). Every action is audited.
 */
import { createHash, randomBytes } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import { deleteUserAccount } from '../account-deletion.ts'
import { BroadcastError, audienceCounts, broadcastRequestSchema, handleBroadcast, recentBroadcasts } from '../email/broadcasts.ts'
import type { EmailConfig } from '../email/config.ts'
import { MAX_EMAIL_IMAGE_BYTES, assetKey, assetUrl, sniffImage } from '../email/images.ts'
import type { EmailService } from '../email/service.ts'
import { adminNetworkApprovalEmail } from '../email/templates-engagement.ts'
import { isUuid } from '../email/text.ts'
import {
  aiCosts,
  auditLog,
  isAdminUser,
  listNetworks,
  listUsers,
  overview,
  removeNetwork,
  setAiTier,
  setLocked,
  updateAiControls,
} from './data.ts'
import { adminJson, audit, authorizeAdmin, type AdminContext, type GuardDeps } from './guard.ts'

type Db = Pick<pg.Client, 'query'>

export type AdminDeps = GuardDeps & {
  db: Db
  email: { service: EmailService; config: EmailConfig }
  /** Public image storage for product emails (Netlify Blobs in production). */
  assets?: { put(key: string, bytes: Uint8Array, contentType: string): Promise<void> }
  /** Delete an account (injected so tests do not need a real transaction). */
  deleteAccount?: (db: Db, userId: string) => ReturnType<typeof deleteUserAccount>
}

const APPROVAL_MINUTES = 15
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

const controlsSchema = z.object({
  ai_enabled: z.boolean().optional(),
  transcription_enabled: z.boolean().optional(),
  analysis_enabled: z.boolean().optional(),
  max_global_daily_cost_usd: z.number().min(0).max(100000).nullable().optional(),
})

async function body(request: Request) {
  const text = await request.text()
  if (text.length > 64 * 1024) return null
  try {
    return text ? (JSON.parse(text) as unknown) : {}
  } catch {
    return null
  }
}

export async function handleAdminRequest(request: Request, deps: AdminDeps): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api\/admin\/?/, '').replace(/\/+$/, '')
  const method = request.method
  const sensitive =
    (method === 'POST' && /^(users\/[^/]+\/(lock|unlock|terminate|tier)|ai\/controls|security\/networks\/remove)$/.test(path)) ||
    false
  const unknownNetworkOk = path === 'session' || path === 'network/request' || path === 'network/confirm'

  const gate = await authorizeAdmin(request, deps, { sensitive, allowUnknownNetwork: unknownNetworkOk })
  if (!gate.ok) return gate.response
  const ctx: AdminContext = gate.ctx
  const log = (action: string, target?: string | null, details?: Record<string, unknown>) =>
    audit(deps.db, { adminId: ctx.userId, action, target, network: ctx.network, details })

  // ── Session & network approval ──────────────────────────────────────────
  if (path === 'session' && method === 'GET') {
    return adminJson(200, {
      email: ctx.email,
      network: ctx.network,
      networkAllowed: ctx.networkAllowed,
      networkRegistered: ctx.networkRegistered,
      emailEnabled: deps.email.service.enabled,
    })
  }

  if (path === 'network/request' && method === 'POST') {
    if (ctx.networkAllowed) return adminJson(400, { error: 'already_allowed' })
    if (!deps.email.service.enabled || !ctx.email) return adminJson(503, { error: 'email_not_configured' })
    const recent = await deps.db.query<{ n: number }>(
      `select count(*)::int as n from private.admin_network_approvals where created_at > now() - interval '1 hour'`,
    )
    if ((recent.rows[0]?.n ?? 0) >= 3) return adminJson(429, { error: 'too_many_requests' })
    const token = randomBytes(32).toString('base64url')
    await deps.db.query(
      `insert into private.admin_network_approvals (token_hash, prefix, expires_at)
       values ($1, $2, now() + make_interval(mins => $3))`,
      [sha256(token), ctx.network, APPROVAL_MINUTES],
    )
    const mail = adminNetworkApprovalEmail({
      approveUrl: `https://${deps.adminHost}/approve-network?token=${token}`,
      network: ctx.network,
      minutes: APPROVAL_MINUTES,
    })
    const sent = await deps.email.service.send({
      category: mail.category,
      template: mail.template,
      to: ctx.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `hilm/admin-network/${sha256(token).slice(0, 32)}`,
    })
    await log('network_approval_requested', ctx.network, { sent: sent.ok })
    return sent.ok ? adminJson(200, { ok: true }) : adminJson(502, { error: 'email_failed' })
  }

  if (path === 'network/confirm' && method === 'POST') {
    const input = (await body(request)) as { token?: unknown } | null
    const token = typeof input?.token === 'string' && input.token.length <= 100 ? input.token : ''
    const row = await deps.db.query<{ prefix: string }>(
      `update private.admin_network_approvals set used_at = now()
       where token_hash = $1 and used_at is null and expires_at > now()
       returning prefix`,
      [sha256(token)],
    )
    const prefix = row.rows[0]?.prefix
    if (!prefix || prefix !== ctx.network) {
      await log('network_approval_rejected', ctx.network)
      return adminJson(400, { error: 'invalid_or_expired' })
    }
    await deps.db.query(
      `insert into private.admin_allowed_networks (prefix, label) values ($1, 'email approval') on conflict (prefix) do nothing`,
      [prefix],
    )
    await log('network_approved', prefix)
    return adminJson(200, { ok: true })
  }

  if (!ctx.networkAllowed) return adminJson(403, { error: 'network_not_allowed' })

  // ── Read models ─────────────────────────────────────────────────────────
  if (path === 'overview' && method === 'GET') return adminJson(200, await overview(deps.db))
  if (path === 'ai' && method === 'GET') return adminJson(200, await aiCosts(deps.db, Number(url.searchParams.get('days') ?? 30)))
  if (path === 'users' && method === 'GET') {
    return adminJson(200, await listUsers(deps.db, url.searchParams.get('q') ?? '', Number(url.searchParams.get('page') ?? 0)))
  }
  if (path === 'audit' && method === 'GET') return adminJson(200, { entries: await auditLog(deps.db) })
  if (path === 'security' && method === 'GET') return adminJson(200, { networks: await listNetworks(deps.db), current: ctx.network })

  // ── Controls ────────────────────────────────────────────────────────────
  if (path === 'ai/controls' && method === 'POST') {
    const parsed = controlsSchema.safeParse(await body(request))
    if (!parsed.success) return adminJson(400, { error: 'invalid_request' })
    await updateAiControls(deps.db, parsed.data)
    await log('ai_controls_updated', 'global', parsed.data)
    return adminJson(200, { ok: true })
  }

  if (path === 'security/networks/remove' && method === 'POST') {
    const input = (await body(request)) as { prefix?: unknown } | null
    const prefix = typeof input?.prefix === 'string' ? input.prefix : ''
    if (prefix === ctx.network) return adminJson(400, { error: 'cannot_remove_current' })
    const removed = await removeNetwork(deps.db, prefix)
    await log('network_removed', prefix)
    return adminJson(removed ? 200 : 404, removed ? { ok: true } : { error: 'not_found' })
  }

  // AI quota tier: only here (trusted server path); users cannot change their own tier.
  const tierAction = path.match(/^users\/([^/]+)\/tier$/)
  if (tierAction && method === 'POST') {
    const userId = tierAction[1]!
    if (!isUuid(userId)) return adminJson(400, { error: 'invalid_user' })
    const input = (await body(request)) as { tier?: unknown } | null
    const tier = typeof input?.tier === 'string' ? input.tier.trim() : ''
    if (!/^[a-z0-9_-]{1,32}$/.test(tier)) return adminJson(400, { error: 'invalid_tier' })
    const changed = await setAiTier(deps.db, userId, tier)
    if (changed !== 'ok') return adminJson(changed === 'unknown_user' ? 404 : 400, { error: changed })
    await log('user_ai_tier_set', userId, { tier })
    return adminJson(200, { ok: true })
  }

  const userAction = path.match(/^users\/([^/]+)\/(lock|unlock|terminate)$/)
  if (userAction && method === 'POST') {
    const [, userId, action] = userAction
    if (!isUuid(userId)) return adminJson(400, { error: 'invalid_user' })
    if (userId === ctx.userId || (await isAdminUser(deps.db, userId))) return adminJson(400, { error: 'cannot_target_admin' })
    if (action === 'lock' || action === 'unlock') {
      const changed = await setLocked(deps.db, userId, action === 'lock')
      await log(action === 'lock' ? 'user_locked' : 'user_unlocked', userId)
      return adminJson(changed ? 200 : 404, changed ? { ok: true } : { error: 'not_found' })
    }
    const input = (await body(request)) as { confirmEmail?: unknown } | null
    const target = await deps.db.query<{ email: string | null }>(`select email from auth.users where id = $1`, [userId])
    const email = target.rows[0]?.email
    if (!target.rows.length) return adminJson(404, { error: 'not_found' })
    if (typeof input?.confirmEmail !== 'string' || input.confirmEmail.trim().toLowerCase() !== (email ?? '').toLowerCase()) {
      return adminJson(400, { error: 'confirm_email_mismatch' })
    }
    const result = await (deps.deleteAccount ?? deleteUserAccount)(deps.db, userId)
    await log('user_terminated', userId, { ok: result.ok, code: result.ok ? null : result.code })
    if (result.ok) return adminJson(200, { ok: true })
    return adminJson(409, result.code === 'owned_shared_workspaces' ? { error: result.code, workspaces: result.workspaces } : { error: result.code })
  }

  // ── Product emails ──────────────────────────────────────────────────────
  if (path === 'assets' && method === 'POST') {
    if (!deps.assets) return adminJson(503, { error: 'storage_not_configured' })
    if (Number(request.headers.get('content-length') || 0) > MAX_EMAIL_IMAGE_BYTES) return adminJson(413, { error: 'image_too_large' })
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (!bytes.length) return adminJson(400, { error: 'empty_upload' })
    if (bytes.length > MAX_EMAIL_IMAGE_BYTES) return adminJson(413, { error: 'image_too_large' })
    // The type comes from the file's bytes, never from the client's Content-Type.
    const kind = sniffImage(bytes)
    if (!kind) return adminJson(415, { error: 'unsupported_image' })
    const key = assetKey(bytes, kind.ext)
    await deps.assets.put(key, bytes, kind.contentType)
    await log('email_image_uploaded', key, { bytes: bytes.length })
    return adminJson(200, { url: assetUrl(deps.email.config.appBaseUrl, key) })
  }

  if (path === 'broadcasts' && method === 'GET') {
    return adminJson(200, {
      sendingEnabled: deps.email.service.enabled && Boolean(deps.email.config.unsubscribeSecret),
      audience: await audienceCounts(deps.db),
      recent: await recentBroadcasts(deps.db),
    })
  }
  if (path === 'broadcasts' && method === 'POST') {
    const parsed = broadcastRequestSchema.safeParse(await body(request))
    if (!parsed.success) return adminJson(400, { error: 'invalid_request' })
    if (parsed.data.action === 'send' && parsed.data.audience !== 'admin') {
      // Sending to users is sensitive: require a fresh TOTP.
      const fresh = await authorizeAdmin(request, deps, { sensitive: true })
      if (!fresh.ok) return fresh.response
    }
    if (!ctx.email) return adminJson(400, { error: 'admin_email_missing' })
    try {
      const result = await handleBroadcast(parsed.data, { id: ctx.userId, email: ctx.email }, {
        db: deps.db,
        service: deps.email.service,
        config: deps.email.config,
      })
      if (parsed.data.action !== 'preview') {
        await log(parsed.data.action === 'send' ? 'broadcast_sent' : 'broadcast_tested', null, {
          audience: parsed.data.audience,
          queued: 'queued' in result ? result.queued : undefined,
        })
      }
      return adminJson(200, { ok: true, ...result })
    } catch (error) {
      if (error instanceof BroadcastError) return adminJson(error.status, { error: error.code })
      throw error
    }
  }

  return adminJson(404, { error: 'not_found' })
}
