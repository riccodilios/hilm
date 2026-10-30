/** Email invitations to a workspace (owners/admins only). */
import type { Config } from '@netlify/functions'
import pg from 'pg'
import { loadEmailConfig } from './_shared/email/config.ts'
import { InviteError, sendWorkspaceInvites } from './_shared/email/invites.ts'
import { logEmail } from './_shared/email/log.ts'
import { createEmailService } from './_shared/email/service.ts'
import { jsonResponse, requestUser } from './_shared/request-user.ts'

export default async (request: Request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' })
  const user = await requestUser(request)
  if (!user) return jsonResponse(401, { error: 'unauthorized' })
  const body = (await request.json().catch(() => null)) as { workspaceId?: unknown; emails?: unknown; locale?: unknown } | null
  if (!body) return jsonResponse(400, { error: 'invalid_body' })

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return jsonResponse(500, { error: 'server_not_configured' })
  const config = loadEmailConfig()
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    const results = await sendWorkspaceInvites(
      { userId: user.id, userEmail: user.email, workspaceId: body.workspaceId, emails: body.emails, locale: body.locale },
      { db: client, service: createEmailService(config), config, log: logEmail },
    )
    return jsonResponse(200, { ok: true, results })
  } catch (error) {
    if (error instanceof InviteError) return jsonResponse(error.status, { error: error.code })
    logEmail('email.invites', { outcome: 'failed', code: 'internal_error' })
    return jsonResponse(500, { error: 'invite_failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const config: Config = {
  path: '/api/workspace-invite',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
