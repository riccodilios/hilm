/** One-click unsubscribe from product news (marketing) emails. */
import type { Config } from '@netlify/functions'
import { withDb } from './_shared/db.ts'
import { loadEmailConfig } from './_shared/email/config.ts'
import { logEmail } from './_shared/email/log.ts'
import { handleUnsubscribe } from './_shared/email/unsubscribe-page.ts'

export default async (request: Request) => {
  const config = loadEmailConfig()
  return handleUnsubscribe(request, {
    secret: config.unsubscribeSecret,
    optOut: async (userId) => {
      await withDb((db) =>
        db.query(`update public.user_settings set email_marketing_enabled = false where user_id = $1`, [userId]),
      )
      logEmail('email.unsubscribe', { outcome: 'received', code: 'marketing_off' })
    },
  })
}

export const config: Config = {
  path: '/api/email-unsubscribe',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
