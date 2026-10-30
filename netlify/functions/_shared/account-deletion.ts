/**
 * Permanently delete a Hilm account (self-service or admin termination). Runs in one transaction:
 * refuses while the user owns workspaces that still have other members, removes sole-owned
 * workspaces, leaves memberships, reassigns restrict FKs, then deletes auth.users (cascades).
 * Sends the account-deleted security notice after commit.
 */
import type pg from 'pg'
import { loadEmailConfig } from './email/config.ts'
import { formatDateTime, normalizeLocale, safeTimeZone } from './email/format.ts'
import { REPLY_TO, createEmailService } from './email/service.ts'
import { accountDeletedEmail } from './email/templates.ts'

type Client = Pick<pg.Client, 'query'>

type DeletedAccount = {
  email: string | null
  confirmed: boolean
  locale: string | null
  time_zone: string | null
  time_format: string | null
}

export type DeletionResult =
  | { ok: true }
  | { ok: false; code: 'owned_shared_workspaces'; workspaces: Array<{ id: string; name: string }> }
  | { ok: false; code: 'not_found' }

async function sendAccountDeletedNotice(userId: string, account: DeletedAccount | undefined) {
  if (!account?.email || !account.confirmed) return
  try {
    const config = loadEmailConfig()
    const service = createEmailService(config)
    if (!service.enabled) return
    const locale = normalizeLocale(account.locale)
    const deletedAtLabel =
      formatDateTime(new Date().toISOString(), {
        locale,
        timeZone: safeTimeZone(account.time_zone),
        timeFormat: account.time_format === '12h' ? '12h' : '24h',
      }) ?? new Date().toISOString()
    const email = accountDeletedEmail({ locale, appBaseUrl: config.appBaseUrl, deletedAtLabel, supportEmail: REPLY_TO })
    await service.send({
      category: email.category,
      template: email.template,
      to: account.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `hilm/account-deleted/${userId}`,
    })
  } catch {
    // Logged by the service; the account is already deleted.
  }
}

export async function deleteUserAccount(client: Client, userId: string): Promise<DeletionResult> {
  await client.query('begin')
  try {
    const shared = await client.query<{ id: string; name: string }>(
      `select w.id, w.name
       from public.workspaces w
       where w.owner_id = $1
         and exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id <> $1)
       order by w.name
       limit 5`,
      [userId],
    )
    if (shared.rows.length) {
      await client.query('rollback')
      return { ok: false, code: 'owned_shared_workspaces', workspaces: shared.rows }
    }

    // Sole-owned workspaces cascade to projects/tasks/members.
    await client.query(`delete from public.workspaces where owner_id = $1`, [userId])
    // Leave remaining memberships.
    await client.query(`delete from public.workspace_members where user_id = $1`, [userId])
    // Reassign restrict FKs so auth.users delete can succeed.
    await client.query(
      `update public.workspace_projects p set created_by = w.owner_id
       from public.workspaces w
       where p.workspace_id = w.id and p.created_by = $1 and w.owner_id <> $1`,
      [userId],
    )
    await client.query(
      `update public.workspace_tasks t set created_by = w.owner_id
       from public.workspaces w
       where t.workspace_id = w.id and t.created_by = $1 and w.owner_id <> $1`,
      [userId],
    )

    const account = await client.query<DeletedAccount>(
      // to_jsonb keeps this working whether or not the email-settings columns exist.
      `select u.email, (u.email_confirmed_at is not null) as confirmed,
              to_jsonb(s) ->> 'locale' as locale,
              to_jsonb(s) ->> 'time_zone' as time_zone,
              to_jsonb(s) ->> 'time_format' as time_format
       from auth.users u left join public.user_settings s on s.user_id = u.id
       where u.id = $1`,
      [userId],
    )
    if (!account.rows.length) {
      await client.query('rollback')
      return { ok: false, code: 'not_found' }
    }

    await client.query(`delete from auth.users where id = $1`, [userId])
    await client.query('commit')
    await sendAccountDeletedNotice(userId, account.rows[0])
    return { ok: true }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}
