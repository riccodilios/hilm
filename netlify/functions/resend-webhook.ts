/**
 * Resend delivery events (bounces, complaints, suppressions). Configure in Resend → Webhooks with
 * the endpoint https://app.hilm.tech/api/resend-webhook and set RESEND_WEBHOOK_SECRET.
 */
import type { Config } from '@netlify/functions'
import type pg from 'pg'
import { Resend } from 'resend'
import { acquireDb } from './_shared/db.ts'
import { loadEmailConfig } from './_shared/email/config.ts'
import { logEmail } from './_shared/email/log.ts'
import { handleResendWebhook, type WebhookEvent, type WebhookStore } from './_shared/email/webhook.ts'

export default async (request: Request) => {
  const config = loadEmailConfig()
  let client: pg.PoolClient | null = null

  const verify =
    config.webhookSecret && config.apiKey
      ? (input: { payload: string; headers: { id: string; timestamp: string; signature: string } }) =>
          new Resend(config.apiKey!).webhooks.verify({
            payload: input.payload,
            headers: input.headers,
            webhookSecret: config.webhookSecret!,
          }) as unknown as WebhookEvent
      : null

  const store = async (): Promise<WebhookStore> => {
    client = await acquireDb()
    const db = client
    return {
      async recordDelivery(id, type, emailId) {
        const { rowCount } = await db.query(
          `insert into private.email_webhook_events (id, type, email_id) values ($1, $2, $3)
           on conflict (id) do nothing`,
          [id, type, emailId],
        )
        return rowCount === 1
      },
      async suppress(addresses, reason) {
        await db.query(
          `insert into private.email_suppressions (email, reason)
           select unnest($1::text[]), $2
           on conflict (email) do nothing`,
          [addresses, reason],
        )
      },
    }
  }

  try {
    return await handleResendWebhook(request, { verify, store, log: logEmail })
  } catch {
    logEmail('email.webhook', { outcome: 'failed', code: 'internal_error' })
    // 500 makes Resend retry the delivery later.
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  } finally {
    const open = client as pg.PoolClient | null
    open?.release()
  }
}

export const config: Config = {
  path: '/api/resend-webhook',
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
