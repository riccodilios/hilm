import type { ActionResult } from '@/features/ai/registry/types'

/**
 * In-session idempotency for AI mutations.
 * Prevents duplicate creates when the UI retries the same Accept / clientKey.
 */
const memory = new Map<string, ActionResult>()

function storageKey(scope: string, clientKey: string) {
  return `hilm:ai-idem:${scope}:${clientKey}`
}

export function rememberActionResult(scope: string, clientKey: string, result: ActionResult) {
  const key = `${scope}::${clientKey}`
  memory.set(key, result)
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      storageKey(scope, clientKey),
      JSON.stringify({
        ok: result.ok,
        summary: result.summary,
        entities: result.entities,
        data: result.data,
        reused: result.reused,
        verified: result.verified,
        code: result.code,
      }),
    )
  } catch {
    /* ignore quota */
  }
}

export function recallActionResult(scope: string, clientKey: string): ActionResult | null {
  const key = `${scope}::${clientKey}`
  const cached = memory.get(key)
  if (cached) return cached
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(storageKey(scope, clientKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActionResult
    memory.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

export function buildCreateClientKey(input: {
  conversationId?: string | null
  title: string
  projectId?: string | null
  index?: number
  explicit?: string | null
}) {
  if (input.explicit?.trim()) return input.explicit.trim().toLowerCase()
  const title = input.title.trim().toLowerCase()
  const project = (input.projectId ?? '').trim().toLowerCase()
  const conversation = (input.conversationId ?? 'anon').trim()
  const index = input.index ?? 0
  return `${conversation}|create|${project}|${index}|${title}`
}
