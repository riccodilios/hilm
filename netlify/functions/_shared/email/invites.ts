/**
 * Emailed workspace invitations. Only workspace owners/admins may invite; addresses are validated,
 * existing members and recent invitees are skipped, and each workspace has a daily cap so the
 * feature cannot be used to spam. The email carries the workspace's existing invite link (same
 * access as copying it from the Team page). Invite codes and addresses are never logged.
 */
import type pg from 'pg'
import type { EmailConfig } from './config.ts'
import type { EmailLocale } from './layout.ts'
import type { EmailLogger } from './log.ts'
import type { EmailService } from './service.ts'
import { workspaceInviteEmail } from './templates-engagement.ts'
import { isUuid, isValidEmailAddress } from './text.ts'

type Queryable = Pick<pg.Client, 'query'>

export const MAX_INVITES_PER_REQUEST = 10
export const MAX_INVITES_PER_DAY = 50

export type InviteStatus =
  | 'sent'
  | 'invalid'
  | 'already_member'
  | 'already_invited'
  | 'suppressed'
  | 'limit_reached'
  | 'failed'

export type InviteResult = { email: string; status: InviteStatus }

export class InviteError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export async function sendWorkspaceInvites(
  input: { userId: string; userEmail: string | null; workspaceId: unknown; emails: unknown; locale: unknown },
  deps: { db: Queryable; service: EmailService; config: EmailConfig; log: EmailLogger },
): Promise<InviteResult[]> {
  const { db } = deps
  if (!isUuid(input.workspaceId)) throw new InviteError(400, 'invalid_workspace')
  if (!Array.isArray(input.emails) || !input.emails.length) throw new InviteError(400, 'no_emails')
  if (input.emails.length > MAX_INVITES_PER_REQUEST) throw new InviteError(400, 'too_many')
  if (!deps.service.enabled) throw new InviteError(503, 'not_configured')
  const locale: EmailLocale = input.locale === 'ar' ? 'ar' : 'en'

  const role = await db.query<{ role: string }>(
    `select role::text as role from public.workspace_members where workspace_id = $1 and user_id = $2`,
    [input.workspaceId, input.userId],
  )
  if (!['owner', 'admin'].includes(role.rows[0]?.role ?? '')) throw new InviteError(403, 'forbidden')

  const ws = await db.query<{ name: string; invite_code: string; inviter: string | null }>(
    `select w.name, w.invite_code,
            (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = $2) as inviter
     from public.workspaces w where w.id = $1`,
    [input.workspaceId, input.userId],
  )
  const workspace = ws.rows[0]
  if (!workspace) throw new InviteError(404, 'not_found')
  const inviterName = workspace.inviter ?? input.userEmail?.split('@')[0] ?? 'A teammate'

  const recent = await db.query<{ n: number }>(
    `select count(*)::int as n from private.workspace_email_invites
     where workspace_id = $1 and created_at > now() - interval '24 hours'`,
    [input.workspaceId],
  )
  let remaining = MAX_INVITES_PER_DAY - (recent.rows[0]?.n ?? 0)

  const seen = new Set<string>()
  const results: InviteResult[] = []
  for (const raw of input.emails) {
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (!isValidEmailAddress(email)) {
      results.push({ email: typeof raw === 'string' ? raw.slice(0, 254) : '', status: 'invalid' })
      continue
    }
    if (seen.has(email)) continue
    seen.add(email)

    const state = await db.query<{ member: boolean; invited: boolean; suppressed: boolean }>(
      `select
         exists (select 1 from public.workspace_members m join auth.users u on u.id = m.user_id
                 where m.workspace_id = $1 and lower(u.email) = $2) as member,
         exists (select 1 from private.workspace_email_invites i
                 where i.workspace_id = $1 and i.email = $2 and i.status <> 'failed'
                   and i.created_at > now() - interval '24 hours') as invited,
         exists (select 1 from private.email_suppressions s where s.email = $2) as suppressed`,
      [input.workspaceId, email],
    )
    const s = state.rows[0]!
    if (s.member) results.push({ email, status: 'already_member' })
    else if (s.invited) results.push({ email, status: 'already_invited' })
    else if (s.suppressed) results.push({ email, status: 'suppressed' })
    else if (remaining <= 0) results.push({ email, status: 'limit_reached' })
    else {
      remaining -= 1
      const row = await db.query<{ id: string }>(
        `insert into private.workspace_email_invites (workspace_id, email, invited_by) values ($1, $2, $3) returning id`,
        [input.workspaceId, email, input.userId],
      )
      const inviteId = row.rows[0]!.id
      const message = workspaceInviteEmail({
        locale,
        appBaseUrl: deps.config.appBaseUrl,
        inviterName,
        workspaceName: workspace.name,
        inviteCode: workspace.invite_code,
      })
      const sent = await deps.service.send({
        category: message.category,
        template: message.template,
        to: email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: `hilm/workspace-invite/${inviteId}`,
      })
      await db.query(`update private.workspace_email_invites set status = $2 where id = $1`, [
        inviteId,
        sent.ok ? 'sent' : 'failed',
      ])
      results.push({ email, status: sent.ok ? 'sent' : 'failed' })
    }
  }
  deps.log('email.invites', {
    outcome: 'sent',
    items: results.filter((r) => r.status === 'sent').length,
  })
  return results
}
