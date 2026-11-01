/**
 * Hourly safety net for background work (see _shared/jobs/scheduler-run.ts). Day to day the
 * database calls scheduler-run only when something is due, so Netlify is not woken every minute.
 * Not publicly routed; Netlify answers 403 to outside requests for scheduled functions.
 */
import type { Config } from '@netlify/functions'
import { authorizeCronRequest } from './_shared/cron-auth'
import { runScheduler } from './_shared/jobs/scheduler-run.ts'
import { instrumented } from './_shared/ops/instrument.ts'

/** Scheduled functions are stopped after 30 s. */
const BUDGET_MS = 25_000

async function handler(request: Request) {
  const auth = authorizeCronRequest(request, process.env.CRON_SECRET)
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { 'Content-Type': 'application/json' } })
  }
  return runScheduler('schedule', BUDGET_MS)
}

export default instrumented('scheduler', handler)

export const config: Config = {
  schedule: '0 * * * *',
}
