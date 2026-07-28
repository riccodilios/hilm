import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import webpush from 'web-push'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

async function loadSecrets() {
  const fromEnv = {
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  }
  if (fromEnv.VAPID_PUBLIC_KEY && fromEnv.VAPID_PRIVATE_KEY) return fromEnv

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return fromEnv

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  })
  try {
    await client.connect()
    const { rows } = await client.query<{ key: string; value: string }>(
      `select key, value from private.server_secrets
       where key in ('VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT')`,
    )
    const mapped = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return { ...fromEnv, ...mapped }
  } finally {
    await client.end().catch(() => undefined)
  }
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return json({ error: 'Supabase not configured' }, 500)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(token)
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  const secrets = await loadSecrets()
  if (!secrets.VAPID_PUBLIC_KEY || !secrets.VAPID_PRIVATE_KEY) {
    return json({ error: 'VAPID keys missing' }, 500)
  }
  webpush.setVapidDetails(
    secrets.VAPID_SUBJECT || 'mailto:noreply@hillm.netlify.app',
    secrets.VAPID_PUBLIC_KEY,
    secrets.VAPID_PRIVATE_KEY,
  )

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return json({ error: 'DATABASE_URL missing' }, 500)

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()

    const { rows: subs } = await client.query<{
      id: string
      endpoint: string
      p256dh: string
      auth: string
    }>(`select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = $1`, [
      user.id,
    ])

    await client.query(
      `insert into public.notifications
        (user_id, channel, type, title, body, href, metadata)
       values ($1, $2, 'test', $3, $4, '/app/notifications', '{}'::jsonb)`,
      [
        user.id,
        subs.length ? 'push' : 'in_app',
        'Hilm test notification',
        subs.length
          ? 'Push is connected on this account.'
          : 'In-app works. Enable Push in Settings (Add to Home Screen on iPhone) for lock-screen alerts.',
      ],
    )

    let pushed = 0
    const payload = JSON.stringify({
      title: 'Hilm test notification',
      body: 'Push is working on this device.',
      href: '/app/notifications',
      tag: 'hilm-test',
    })

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        pushed += 1
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0
        if (statusCode === 404 || statusCode === 410) {
          await client.query(`delete from public.push_subscriptions where id = $1`, [sub.id])
        }
      }
    }

    return json({
      ok: true,
      pushed,
      subscriptions: subs.length,
      hint:
        subs.length === 0
          ? 'No push subscription saved for this account yet. Toggle Push ON in Settings on this device.'
          : undefined,
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Test failed' }, 500)
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const config: Config = {
  // no schedule — on-demand only
}
