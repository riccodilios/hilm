import { describe, expect, it, vi } from 'vitest'
import { fakeDb } from '../email/fake-db.test-helper.ts'
import { loadEmailConfig } from '../email/config.ts'
import type { EmailService, SendInput } from '../email/service.ts'
import { authorizeAdmin } from './guard.ts'
import { clientIp, networkPrefix } from './network.ts'
import { handleAdminRequest, type AdminDeps } from './router.ts'

const HOST = 'ctl-test.hilm.tech'
const ADMIN = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-10-30T12:00:00Z')

function jwt(claims: Record<string, unknown>) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `${enc({ alg: 'HS256' })}.${enc(claims)}.sig`
}
const fresh = (over: Record<string, unknown> = {}) =>
  jwt({
    sub: ADMIN,
    aal: 'aal2',
    amr: [
      { method: 'password', timestamp: NOW / 1000 - 300 },
      { method: 'totp', timestamp: NOW / 1000 - 60 },
    ],
    ...over,
  })

function req(
  path: string,
  opts: { method?: string; token?: string | null; origin?: string | null; ip?: string; host?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { 'x-nf-client-connection-ip': opts.ip ?? '203.0.113.7' }
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? fresh()}`
  if (opts.origin !== null && (opts.method ?? 'GET') !== 'GET') headers.origin = opts.origin ?? `https://${HOST}`
  return new Request(`https://${opts.host ?? HOST}/api/admin/${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

function setup(state: { admins?: string[]; networks?: string[] } = {}) {
  const admins = new Set(state.admins ?? [ADMIN])
  const networks = new Set(state.networks ?? ['203.0.113.0/24'])
  const auditActions: string[] = []
  const approvals = new Map<string, string>()
  const db = fakeDb([
    [/from private\.admin_users where user_id/, (p) => ({ rows: admins.has(p[0] as string) ? [{ ok: true }] : [] })],
    [/select prefix from private\.admin_allowed_networks$/, () => ({ rows: [...networks].map((prefix) => ({ prefix })) })],
    [/insert into private\.admin_allowed_networks/, (p) => (networks.add(p[0] as string), { rowCount: 1 })],
    [/update private\.admin_allowed_networks/, () => ({ rowCount: 1 })],
    [/insert into private\.admin_audit_log/, (p) => (auditActions.push(p[1] as string), { rowCount: 1 })],
    [/from private\.admin_network_approvals where created_at/, () => ({ rows: [{ n: 0 }] })],
    [/insert into private\.admin_network_approvals/, (p) => (approvals.set(p[0] as string, p[1] as string), { rowCount: 1 })],
    [
      /update private\.admin_network_approvals set used_at/,
      (p) => {
        // Mirrors "where used_at is null ... set used_at = now()": a link works once.
        const prefix = approvals.get(p[0] as string)
        approvals.delete(p[0] as string)
        return { rows: prefix ? [{ prefix }] : [] }
      },
    ],
    [/update auth\.users set banned_until/, () => ({ rowCount: 1 })],
    [/delete from auth\.sessions/, () => ({ rowCount: 1 })],
    [/delete from auth\.refresh_tokens/, () => ({ rowCount: 1 })],
    [/select email from auth\.users where id/, () => ({ rows: [{ email: 'target@example.com' }] })],
  ])
  const sends: SendInput[] = []
  const service: EmailService = {
    enabled: true,
    send: vi.fn(async (input: SendInput) => {
      sends.push(input)
      return { ok: true as const, id: 'msg' }
    }),
  }
  const deleteAccount = vi.fn(async () => ({ ok: true as const }))
  const deps: AdminDeps = {
    adminHost: HOST,
    db,
    getUser: async (token) => {
      const sub = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub as string
      return { id: sub, email: sub === ADMIN ? 'owner@example.com' : 'someone@example.com' }
    },
    now: () => NOW,
    email: { service, config: loadEmailConfig({ RESEND_API_KEY: 're_test' }) },
    deleteAccount,
  }
  return { deps, db, networks, auditActions, sends, deleteAccount }
}

const statusOf = async (g: Awaited<ReturnType<typeof authorizeAdmin>>) => (g.ok ? 200 : g.response.status)

describe('networkPrefix', () => {
  it('binds IPv4 to /24 and IPv6 to /64', () => {
    expect(networkPrefix('203.0.113.77')).toBe('203.0.113.0/24')
    expect(networkPrefix('2001:db8::1')).toBe('2001:0db8:0000:0000::/64')
    expect(networkPrefix('2001:db8:aa:bb:cc:dd:ee:ff')).toBe('2001:0db8:00aa:00bb::/64')
    expect(networkPrefix('::ffff:198.51.100.9')).toBe('198.51.100.0/24')
    expect(networkPrefix('not-an-ip')).toBeNull()
    expect(networkPrefix(null)).toBeNull()
  })

  it('prefers the Netlify client IP header', () => {
    const r = new Request('https://x', { headers: { 'x-nf-client-connection-ip': '198.51.100.1', 'x-forwarded-for': '10.0.0.1' } })
    expect(clientIp(r)).toBe('198.51.100.1')
  })
})

describe('authorizeAdmin', () => {
  it('is invisible on any other host', async () => {
    const { deps } = setup()
    expect(await statusOf(await authorizeAdmin(req('overview', { host: 'app.hilm.tech' }), deps))).toBe(404)
  })

  it('rejects cross-site writes, missing tokens and non-admins', async () => {
    const { deps, auditActions } = setup()
    expect(await statusOf(await authorizeAdmin(req('ai/controls', { method: 'POST', origin: 'https://evil.example' }), deps))).toBe(403)
    expect(await statusOf(await authorizeAdmin(req('overview', { token: null }), deps))).toBe(401)
    expect(await statusOf(await authorizeAdmin(req('overview', { token: jwt({ sub: OTHER, aal: 'aal2' }) }), deps))).toBe(403)
    expect(auditActions).toContain('denied_not_admin')
  })

  it('requires MFA (aal2)', async () => {
    const { deps } = setup()
    const g = await authorizeAdmin(req('overview', { token: fresh({ aal: 'aal1' }) }), deps)
    expect(g.ok ? null : await g.response.json()).toEqual({ error: 'mfa_required' })
  })

  it('pins the first network and refuses others', async () => {
    const { deps, networks, auditActions } = setup({ networks: [] })
    const first = await authorizeAdmin(req('overview', { ip: '198.51.100.20' }), deps)
    expect(first.ok && first.ctx.networkRegistered).toBe(true)
    expect([...networks]).toEqual(['198.51.100.0/24'])
    expect((await authorizeAdmin(req('overview', { ip: '198.51.100.99' }), deps)).ok).toBe(true)
    expect(await statusOf(await authorizeAdmin(req('overview', { ip: '192.0.2.5' }), deps))).toBe(403)
    expect(auditActions).toEqual(['network_registered', 'denied_network'])
  })

  it('needs a TOTP from the last 10 minutes for sensitive actions', async () => {
    const { deps } = setup()
    const stale = fresh({ amr: [{ method: 'totp', timestamp: NOW / 1000 - 3600 }] })
    const old = await authorizeAdmin(req('users/x/lock', { method: 'POST', token: stale }), deps, { sensitive: true })
    expect(old.ok ? null : await old.response.json()).toEqual({ error: 'reauth_required' })
    expect((await authorizeAdmin(req('users/x/lock', { method: 'POST' }), deps, { sensitive: true })).ok).toBe(true)
  })
})

describe('handleAdminRequest', () => {
  it('locks an account and ends its sessions, but never the admin', async () => {
    const { deps, db } = setup()
    expect((await handleAdminRequest(req(`users/${OTHER}/lock`, { method: 'POST', body: {} }), deps)).status).toBe(200)
    expect(db.calls.some((c) => /delete from auth\.sessions/.test(c.sql))).toBe(true)
    const self = await handleAdminRequest(req(`users/${ADMIN}/lock`, { method: 'POST', body: {} }), deps)
    expect(await self.json()).toEqual({ error: 'cannot_target_admin' })
  })

  it('terminates only after the email is typed back', async () => {
    const { deps, deleteAccount } = setup()
    const wrong = await handleAdminRequest(
      req(`users/${OTHER}/terminate`, { method: 'POST', body: { confirmEmail: 'nope@example.com' } }),
      deps,
    )
    expect(wrong.status).toBe(400)
    expect(deleteAccount).not.toHaveBeenCalled()
    const ok = await handleAdminRequest(
      req(`users/${OTHER}/terminate`, { method: 'POST', body: { confirmEmail: 'Target@example.com' } }),
      deps,
    )
    expect(ok.status).toBe(200)
    expect(deleteAccount).toHaveBeenCalledWith(deps.db, OTHER)
  })

  it('approves a new network only via the emailed link opened from that network', async () => {
    const { deps, networks, sends } = setup()
    expect((await handleAdminRequest(req('overview', { ip: '192.0.2.5' }), deps)).status).toBe(403)
    const asked = await handleAdminRequest(req('network/request', { method: 'POST', ip: '192.0.2.5', body: {} }), deps)
    expect(asked.status).toBe(200)
    const link = sends[0]!.text.match(/https:\/\/ctl-test\.hilm\.tech\/approve-network\?token=([A-Za-z0-9_-]+)/)
    expect(link).not.toBeNull()
    const token = link![1]!
    const elsewhere = await handleAdminRequest(req('network/confirm', { method: 'POST', ip: '198.51.100.1', body: { token } }), deps)
    expect(elsewhere.status).toBe(400)
    expect(networks.has('192.0.2.0/24')).toBe(false)
    const same = await handleAdminRequest(req('network/confirm', { method: 'POST', ip: '192.0.2.77', body: { token } }), deps)
    expect(same.status).toBe(400) // single use: the first (wrong-network) attempt consumed it
  })
})
