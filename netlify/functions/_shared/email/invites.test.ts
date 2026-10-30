import { describe, expect, it, vi } from 'vitest'
import { loadEmailConfig } from './config.ts'
import { fakeDb } from './fake-db.test-helper.ts'
import { InviteError, sendWorkspaceInvites } from './invites.ts'
import type { EmailService, SendInput } from './service.ts'

const WS = '22222222-2222-4222-8222-222222222222'
const USER = '11111111-1111-4111-8111-111111111111'
const config = loadEmailConfig({ RESEND_API_KEY: 're_test' })

function setup(opts: { role?: string; recent?: number; members?: string[]; invited?: string[]; suppressed?: string[] } = {}) {
  let n = 0
  const db = fakeDb([
    [/select role::text as role/, () => ({ rows: opts.role ? [{ role: opts.role }] : [] })],
    [/select w.name, w.invite_code/, () => ({ rows: [{ name: 'Acme', invite_code: 'ACME-1234', inviter: 'Omar' }] })],
    [/select count\(\*\)::int as n from private.workspace_email_invites/, () => ({ rows: [{ n: opts.recent ?? 0 }] })],
    [
      /as member,/,
      (p) => ({
        rows: [
          {
            member: (opts.members ?? []).includes(p[1] as string),
            invited: (opts.invited ?? []).includes(p[1] as string),
            suppressed: (opts.suppressed ?? []).includes(p[1] as string),
          },
        ],
      }),
    ],
    [/insert into private.workspace_email_invites/, () => ({ rows: [{ id: `inv-${++n}` }] })],
  ])
  const sends: SendInput[] = []
  const service: EmailService = {
    enabled: true,
    send: vi.fn(async (input: SendInput) => {
      sends.push(input)
      return { ok: true as const, id: 'msg' }
    }),
  }
  const run = (emails: unknown, extra: Partial<{ locale: string }> = {}) =>
    sendWorkspaceInvites(
      { userId: USER, userEmail: 'owner@example.com', workspaceId: WS, emails, locale: extra.locale ?? 'en' },
      { db, service, config, log: () => undefined },
    )
  return { db, sends, service, run }
}

describe('sendWorkspaceInvites', () => {
  it('only lets owners and admins invite', async () => {
    for (const role of [undefined, 'member', 'viewer']) {
      const { run, sends } = setup({ role })
      await expect(run(['a@example.com'])).rejects.toMatchObject({ status: 403, code: 'forbidden' })
      expect(sends).toHaveLength(0)
    }
  })

  it('emails the existing invite link from the team identity', async () => {
    const { run, sends } = setup({ role: 'admin' })
    const results = await run(['Teammate@Example.com'])
    expect(results).toEqual([{ email: 'teammate@example.com', status: 'sent' }])
    expect(sends[0]!.category).toBe('team')
    expect(sends[0]!.subject).toBe('Omar invited you to Acme on Hilm')
    expect(sends[0]!.text).toContain('https://app.hilm.tech/workspace?join=ACME-1234')
    expect(sends[0]!.idempotencyKey).toBe('hilm/workspace-invite/inv-1')
  })

  it('skips invalid, duplicate, member, recently invited and suppressed addresses', async () => {
    const { run, sends } = setup({
      role: 'owner',
      members: ['member@example.com'],
      invited: ['again@example.com'],
      suppressed: ['bounced@example.com'],
    })
    const results = await run(['not-an-email', 'member@example.com', 'again@example.com', 'bounced@example.com', 'ok@example.com', 'OK@example.com'])
    expect(results.map((r) => r.status)).toEqual(['invalid', 'already_member', 'already_invited', 'suppressed', 'sent'])
    expect(sends).toHaveLength(1)
  })

  it('enforces the per-request and daily limits', async () => {
    const { run } = setup({ role: 'owner', recent: 49 })
    await expect(run(Array.from({ length: 11 }, (_, i) => `u${i}@example.com`))).rejects.toBeInstanceOf(InviteError)
    const results = await run(['a@example.com', 'b@example.com'])
    expect(results.map((r) => r.status)).toEqual(['sent', 'limit_reached'])
  })

  it('refuses when email is not configured', async () => {
    const { run, service } = setup({ role: 'owner' })
    ;(service as { enabled: boolean }).enabled = false
    await expect(run(['a@example.com'])).rejects.toMatchObject({ status: 503 })
  })
})
