/**
 * Admin portal API. Served only on ADMIN_HOST (private subdomain); see _shared/admin/guard.ts
 * for the full access policy and docs/admin-portal.md for setup.
 */
import type { Config } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import type pg from 'pg'
import { acquireDb, databaseUrl } from './_shared/db.ts'
import { EMAIL_ASSET_STORE } from './_shared/email/images.ts'
import { handleAdminRequest } from './_shared/admin/router.ts'
import { adminJson } from './_shared/admin/guard.ts'
import { loadEmailConfig } from './_shared/email/config.ts'
import { createEmailService } from './_shared/email/service.ts'
import { requestUser } from './_shared/request-user.ts'
import { instrumented } from './_shared/ops/instrument.ts'
import { loadOpenRouterKey } from './_shared/ai-guard.ts'
import { runMetricsCollection } from './_shared/ops/collector.ts'
import { storageProviders } from './_shared/storage/index.ts'
import { runStorageLifecycle } from './_shared/storage/lifecycle.ts'

async function handler(request: Request) {
  const adminHost = process.env.ADMIN_HOST?.trim().toLowerCase() || null
  if (!adminHost || new URL(request.url).host.toLowerCase() !== adminHost) return adminJson(404, { error: 'not_found' })

  if (!databaseUrl()) return adminJson(500, { error: 'server_not_configured' })
  const emailConfig = loadEmailConfig()
  let client: pg.PoolClient | null = null
  try {
    client = await acquireDb()
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
      infra: {
        collect: async () => {
          const result = await runMetricsCollection(client!, { env: process.env, openRouterKey: loadOpenRouterKey })
          await client!.query(
            `update private.ops_collector_state set last_attempt_at = now(),
               last_success_at = case when $1::text is null then now() else last_success_at end, last_error = $1
             where collector = 'metrics'`,
            [result.errors.length ? result.errors.join('; ').slice(0, 500) : null],
          )
          return result
        },
        runLifecycle: () => runStorageLifecycle(client!, storageProviders(), { trigger: 'admin', budgetMs: 6_000 }),
      },
    })
  } catch {
    console.error(JSON.stringify({ scope: 'admin', event: 'admin.request', outcome: 'failed' }))
    return adminJson(500, { error: 'internal_error' })
  } finally {
    client?.release()
  }
}

export const config: Config = {
  path: '/api/admin/*',
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}

export default instrumented('admin-portal', handler)
