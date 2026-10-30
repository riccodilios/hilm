/** Product broadcast composer API (admins listed in HILM_ADMIN_EMAILS only). */
import type { Config } from '@netlify/functions'
import pg from 'pg'
import {
  BroadcastError,
  audienceCounts,
  broadcastRequestSchema,
  handleBroadcast,
  isBroadcastAdmin,
  recentBroadcasts,
} from './_shared/email/broadcasts.ts'
import { loadEmailConfig } from './_shared/email/config.ts'
import { logEmail } from './_shared/email/log.ts'
import { createEmailService } from './_shared/email/service.ts'
import { jsonResponse, requestUser } from './_shared/request-user.ts'

export default async (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' })
  const user = await requestUser(request)
  if (!user) return jsonResponse(401, { error: 'unauthorized' })
  const config = loadEmailConfig()
  if (!isBroadcastAdmin(config, user)) return jsonResponse(request.method === 'GET' ? 200 : 403, { admin: false })

  let body: ReturnType<typeof broadcastRequestSchema.safeParse> | null = null
  if (request.method === 'POST') {
    body = broadcastRequestSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) return jsonResponse(400, { error: 'invalid_request' })
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return jsonResponse(500, { error: 'server_not_configured' })
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  const service = createEmailService(config)
  try {
    await client.connect()
    if (!body) {
      return jsonResponse(200, {
        admin: true,
        sendingEnabled: service.enabled && Boolean(config.unsubscribeSecret),
        audience: await audienceCounts(client),
        recent: await recentBroadcasts(client),
      })
    }
    const result = await handleBroadcast(body.data!, { id: user.id, email: user.email! }, { db: client, service, config })
    if ('queued' in result) logEmail('email.broadcast', { outcome: 'sent', items: result.queued })
    return jsonResponse(200, { ok: true, ...result })
  } catch (error) {
    if (error instanceof BroadcastError) return jsonResponse(error.status, { error: error.code })
    logEmail('email.broadcast', { outcome: 'failed', code: 'internal_error' })
    return jsonResponse(500, { error: 'broadcast_failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const config: Config = {
  path: '/api/admin-email',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
