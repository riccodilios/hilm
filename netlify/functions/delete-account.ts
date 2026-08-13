import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

function json(data: unknown, status = 200, request?: Request) {
  const origin = request?.headers.get('origin') || ''
  const allowed = new Set(
    [
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

    await client.query(`delete from auth.users where id = $1`, [user.id])
    await client.query('commit')
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
