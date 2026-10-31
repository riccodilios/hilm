import type { Config } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import type pg from 'pg'
import { deleteUserAccount, ownedSharedWorkspaces } from './_shared/account-deletion.ts'
import {
  listPersonalObjects,
  markObjectsRemoved,
  removeObjectsAsUser,
  type RemovedObject,
} from './_shared/account-storage.ts'
import { acquireDb, databaseUrl } from './_shared/db.ts'

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

  if (!databaseUrl()) return respond({ error: 'DATABASE_URL missing' }, 500)

  let client: pg.PoolClient | null = null
  try {
    client = await acquireDb()
    const blocking = await ownedSharedWorkspaces(client, user.id)
    if (blocking.length) {
      return respond(
        {
          error:
            'Transfer or delete workspaces you own that still have other members before deleting your account.',
          code: 'owned_shared_workspaces',
          workspaces: blocking,
        },
        409,
      )
    }
    // Personal files go first, while the user's token is still valid for the Storage API.
    let removed: RemovedObject[] = []
    try {
      const objects = await listPersonalObjects(client, user.id)
      removed = await removeObjectsAsUser({ supabaseUrl, anonKey, token, objects })
    } catch {
      // Anything not removed here stays recorded in private.storage_object_deletions.
    }
    const result = await deleteUserAccount(client, user.id)
    if (result.ok) {
      await markObjectsRemoved(client, removed).catch(() => undefined)
      return respond({ ok: true })
    }
    if (result.code === 'owned_shared_workspaces') {
      return respond(
        {
          error:
            'Transfer or delete workspaces you own that still have other members before deleting your account.',
          code: 'owned_shared_workspaces',
          workspaces: result.workspaces,
        },
        409,
      )
    }
    return respond({ error: 'Account not found' }, 404)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not delete account'
    return respond({ error: message }, 500)
  } finally {
    client?.release()
  }
}

export const config: Config = {
  path: '/api/delete-account',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
