/** Shared cron/job authorization — fail closed when secret is missing. */

export function extractCronSecret(request: Request) {
  const header =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
  return header.trim()
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Authorize scheduled jobs.
 * - CRON_SECRET must be configured (fail closed); a matching secret in a header is accepted.
 *   Query-string secrets are not accepted (they end up in logs).
 * - `x-netlify-event: schedule` is accepted only because the functions using this guard are
 *   scheduled-only: Netlify answers 403 to any external request for a scheduled function, so the
 *   header cannot be forged from outside (covered by tests/security). Never give such a function a
 *   public `path`.
 */
export function authorizeCronRequest(
  request: Request,
  cronSecret: string | undefined | null,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!cronSecret?.trim()) {
    return { ok: false, status: 500, error: 'CRON_SECRET not configured' }
  }

  const provided = extractCronSecret(request)
  if (provided && timingSafeEqual(provided, cronSecret.trim())) return { ok: true }

  if (request.headers.get('x-netlify-event') === 'schedule') {
    if (request.headers.get('origin') || request.headers.get('referer')) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    return { ok: true }
  }

  return { ok: false, status: 401, error: 'Unauthorized' }
}
