/**
 * Background work, called by the database (pg_cron + pg_net, private.scheduler_tick) only when a
 * reminder, an email or a periodic job is due. Accepts nothing but the dedicated SCHEDULER_SECRET
 * header; the scheduled-event header is not trusted here because this function has a public path.
 */
import type { Config } from '@netlify/functions'
import { authorizeSecretRequest } from './_shared/cron-auth'
import { runScheduler } from './_shared/jobs/scheduler-run.ts'
import { instrumented } from './_shared/ops/instrument.ts'

/** Synchronous functions are stopped after the configured timeout (26 s, netlify.toml). */
const BUDGET_MS = 22_000

async function handler(request: Request) {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const auth = authorizeSecretRequest(request, process.env.SCHEDULER_SECRET)
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { 'Content-Type': 'application/json' } })
  }
  return runScheduler('database', BUDGET_MS)
}

export default instrumented('scheduler-run', handler)

export const config: Config = {
  path: '/api/scheduler-run',
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] },
}
