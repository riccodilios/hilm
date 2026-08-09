/** Shared cron/job authorization — fail closed when secret is missing. */

export function extractCronSecret(request: Request) {
  const header =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
  if (header.trim()) return header.trim()
  try {
    return new URL(request.url).searchParams.get('cron_secret')?.trim() || ''
  } catch {
    return ''
  }
}

/**
 * Authorize reminder/cron HTTP jobs.
 * - Always requires CRON_SECRET to be configured (fail closed).
 * - Accepts matching secret via header/query.
 * - Netlify native schedule (`x-netlify-event: schedule`) is allowed only when
 *   the call has no browser Origin/Referer (raises the bar vs open bypass).
 */
export function authorizeCronRequest(
  request: Request,
  cronSecret: string | undefined | null,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!cronSecret?.trim()) {
    return { ok: false, status: 500, error: 'CRON_SECRET not configured' }
  }

  const provided = extractCronSecret(request)
  if (provided && provided === cronSecret) return { ok: true }

  const isNetlifySchedule = request.headers.get('x-netlify-event') === 'schedule'
  if (isNetlifySchedule) {
    const origin = request.headers.get('origin')
    const referer = request.headers.get('referer')
    if (origin || referer) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    return { ok: true }
  }

  return { ok: false, status: 401, error: 'Unauthorized' }
}
