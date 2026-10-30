/**
 * Admin portal API. Served only on ADMIN_HOST (private subdomain); see _shared/admin/guard.ts
 * for the full access policy and docs/admin-portal.md for setup.
 */
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import pg from 'pg'
import { EMAIL_ASSET_STORE } from './_shared/email/images.ts'
import { handleAdminRequest } from './_shared/admin/router.ts'
import { adminJson } from './_shared/admin/guard.ts'
import { loadEmailConfig } from './_shared/email/config.ts'
import { createEmailService } from './_shared/email/service.ts'
import { requestUser } from './_shared/request-user.ts'

export default async (request: Request) => {
  const adminHost = process.env.ADMIN_HOST?.trim().toLowerCase() || null
  if (!adminHost || new URL(request.url).host.toLowerCase() !== adminHost) return adminJson(404, { error: 'not_found' })

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return adminJson(500, { error: 'server_not_configured' })
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  const emailConfig = loadEmailConfig()
  try {
    await client.connect()
    return await handleAdminRequest(request, {
      adminHost,
      db: client,
      getUser: async (token) => {
        const user = await requestUser(new Request(request.url, { headers: { Authorization: `Bearer ${token}` } }))
        return user ? { id: user.id, email: user.email } : null
      },
      email: { service: createEmailService(emailConfig), config: emailConfig },
      assets: {
        async put(key, bytes, contentType) {
          await getStore({ name: EMAIL_ASSET_STORE, consistency: 'strong' }).set(key, bytes.slice().buffer, {
            metadata: { contentType, uploadedAt: new Date().toISOString() },
          })
        },
      },
    })
  } catch {
    console.error(JSON.stringify({ scope: 'admin', event: 'admin.request', outcome: 'failed' }))
    return adminJson(500, { error: 'internal_error' })
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const config: Config = {
  path: '/api/admin/*',
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
