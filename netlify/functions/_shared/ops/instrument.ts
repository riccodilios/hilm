import { databaseUrl, withDb } from '../db.ts'

type Handler = (request: Request, context?: unknown) => Promise<Response> | Response
type ContextWithWaitUntil = { waitUntil?: (promise: Promise<unknown>) => void }

/**
 * Counts invocations, errors and duration per function per day (private.ops_function_daily).
 * Netlify's API only reports site-wide totals; this gives the per-function split for the admin
 * console. The write runs after the response is returned and never affects it.
 */
export function instrumented(fn: string, handler: Handler): Handler {
  return async (request, context) => {
    const started = Date.now()
    let failed = false
    try {
      const response = await handler(request, context)
      failed = response.status >= 500
      return response
    } catch (error) {
      failed = true
      throw error
    } finally {
      const pending = recordInvocation(fn, Date.now() - started, failed)
      const waitUntil = (context as ContextWithWaitUntil | undefined)?.waitUntil
      if (typeof waitUntil === 'function') waitUntil.call(context, pending)
      else await pending
    }
  }
}

export async function recordInvocation(fn: string, durationMs: number, failed: boolean) {
  if (!databaseUrl()) return
  try {
    await withDb((db) =>
      db.query(
        `insert into private.ops_function_daily (day, fn, invocations, errors, total_ms, max_ms)
         values (current_date, $1, 1, $2, $3, $3)
         on conflict (day, fn) do update set
           invocations = ops_function_daily.invocations + 1,
           errors = ops_function_daily.errors + excluded.errors,
           total_ms = ops_function_daily.total_ms + excluded.total_ms,
           max_ms = greatest(ops_function_daily.max_ms, excluded.max_ms)`,
        [fn, failed ? 1 : 0, Math.max(0, Math.round(durationMs))],
      ),
    )
  } catch {
    // Monitoring must never break the function it measures.
  }
}
