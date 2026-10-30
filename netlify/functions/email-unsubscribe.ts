/** One-click unsubscribe from product news (marketing) emails. */
import type { Config } from '@netlify/functions'
import pg from 'pg'
import { loadEmailConfig } from './_shared/email/config.ts'
import { logEmail } from './_shared/email/log.ts'
import { handleUnsubscribe } from './_shared/email/unsubscribe-page.ts'

export default async (request: Request) => {
  const config = loadEmailConfig()
  return handleUnsubscribe(request, {
    secret: config.unsubscribeSecret,
    optOut: async (userId) => {
      const databaseUrl = process.env.DATABASE_URL
      if (!databaseUrl) throw new Error('DATABASE_URL is not configured')
      const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
      try {
        await client.connect()
        await client.query(`update public.user_settings set email_marketing_enabled = false where user_id = $1`, [userId])
        logEmail('email.unsubscribe', { outcome: 'received', code: 'marketing_off' })
      } finally {
        await client.end().catch(() => undefined)
      }
    },
  })
}

export const config: Config = {
  path: '/api/email-unsubscribe',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
