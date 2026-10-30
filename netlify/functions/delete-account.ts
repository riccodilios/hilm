import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { loadEmailConfig } from './_shared/email/config.ts'
import { formatDateTime, normalizeLocale, safeTimeZone } from './_shared/email/format.ts'
import { REPLY_TO, createEmailService } from './_shared/email/service.ts'
import { accountDeletedEmail } from './_shared/email/templates.ts'

type DeletedAccount = {
  email: string | null
  confirmed: boolean
  locale: string | null
  time_zone: string | null
  time_format: string | null
}

/** Security notice to the deleted account's own (confirmed) address. Never blocks the deletion. */
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

function json(data: unknown, status = 200, request?: Request) {
  const origin = request?.headers.get('origin') || ''
  const allowed = new Set(
    [
      'https://app.hilm.tech',
      'https://hilm.tech',
      'https://www.hilm.tech',
      'https://hillm.netlify.app',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      (process.env.APP_URL || process.env.VITE_APP_URL || '').replace(/\/$/, ''),
    ].filter(Boolean),
  )
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return new Response(JSON.stringify(data), { status, headers })
}

export default async (request: Request) => {
  const respond = (data: unknown, status = 200) => json(data, status, request)

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: json({}, 200, request).headers })
  }
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return respond({ error: 'Unauthorized' }, 401)

  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return respond({ error: 'Supabase not configured' }, 500)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(token)
  if (authError || !user) return respond({ error: 'Unauthorized' }, 401)

  const body = (await request.json().catch(() => ({}))) as { confirm?: string }
  if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') {
    return respond({ error: 'Confirmation required', code: 'confirm_required' }, 400)
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return respond({ error: 'DATABASE_URL missing' }, 500)

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    await client.query('begin')

    const shared = await client.query<{ id: string; name: string }>(
      `select w.id, w.name
       from public.workspaces w
       where w.owner_id = $1
         and exists (
           select 1
           from public.workspace_members m
           where m.workspace_id = w.id
             and m.user_id <> $1
         )
       order by w.name
       limit 5`,
      [user.id],
    )
    if (shared.rows.length) {
      await client.query('rollback')
      return respond(
        {
          error:
            'Transfer or delete workspaces you own that still have other members before deleting your account.',
          code: 'owned_shared_workspaces',
          workspaces: shared.rows,
        },
        409,
      )
    }

    // Sole-owned workspaces cascade to projects/tasks/members.
    await client.query(`delete from public.workspaces where owner_id = $1`, [user.id])

    // Leave remaining memberships.
    await client.query(`delete from public.workspace_members where user_id = $1`, [user.id])

    // Reassign restrict FKs so auth.users delete can succeed.
    await client.query(
      `update public.workspace_projects p
       set created_by = w.owner_id
       from public.workspaces w
       where p.workspace_id = w.id
         and p.created_by = $1
         and w.owner_id <> $1`,
      [user.id],
    )
    await client.query(
      `update public.workspace_tasks t
       set created_by = w.owner_id
       from public.workspaces w
       where t.workspace_id = w.id
         and t.created_by = $1
         and w.owner_id <> $1`,
      [user.id],
    )

    const account = await client.query<DeletedAccount>(
      // to_jsonb keeps this working whether or not the email-settings columns exist yet.
      `select u.email, (u.email_confirmed_at is not null) as confirmed,
              to_jsonb(s) ->> 'locale' as locale,
              to_jsonb(s) ->> 'time_zone' as time_zone,
              to_jsonb(s) ->> 'time_format' as time_format
       from auth.users u left join public.user_settings s on s.user_id = u.id
       where u.id = $1`,
      [user.id],
    )

    await client.query(`delete from auth.users where id = $1`, [user.id])
    await client.query('commit')
    await sendAccountDeletedNotice(user.id, account.rows[0])
    return respond({ ok: true })
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // ignore
    }
    const message = error instanceof Error ? error.message : 'Could not delete account'
    return respond({ error: message }, 500)
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const config: Config = {
  path: '/api/delete-account',
}
