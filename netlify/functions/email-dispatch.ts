/**
 * Sends queued transactional email (private.email_outbox) every minute. Not publicly routed;
 * callable only by Netlify's scheduler or with CRON_SECRET.
 */
import type { Config } from '@netlify/functions'
import pg from 'pg'
import { authorizeCronRequest } from './_shared/cron-auth'
import { loadEmailConfig } from './_shared/email/config.ts'
import { drainOutbox } from './_shared/email/outbox.ts'
import { createEmailService } from './_shared/email/service.ts'
import { createPgOutboxStore } from './_shared/email/store-pg.ts'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export default async (request: Request) => {
  const auth = authorizeCronRequest(request, process.env.CRON_SECRET)
  if (!auth.ok) return json({ error: auth.error }, auth.status)

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return json({ error: 'DATABASE_URL is not configured' }, 500)

  const config = loadEmailConfig()
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    const result = await drainOutbox(
      { store: createPgOutboxStore(client), service: createEmailService(config), config },
      { limit: 25, budgetMs: 20_000 },
    )
    return json({ ok: true, enabled: Boolean(config.apiKey) && !config.problems.length, ...result })
  } catch (error) {
    console.error(JSON.stringify({ scope: 'email', event: 'email.dispatch', outcome: 'failed', code: error instanceof Error ? error.name : 'unknown' }))
    return json({ error: 'dispatch_failed' }, 500)
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const config: Config = {
  schedule: '* * * * *',
}
