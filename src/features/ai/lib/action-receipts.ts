import type { ActionResult } from '@/features/ai/registry/types'

/** Authoritative mutation receipt returned to the AI/UI layer. */
export type ActionReceipt = {
  success: boolean
  action: string
  entity?: string
  entityId?: string
  verified: boolean
  reused?: boolean
  ambiguous?: boolean
  data?: Record<string, unknown>
  error?: { code: string; message: string }
}

export function receiptFromResult(
  actionType: string,
  result: ActionResult,
): ActionReceipt {
  const entity = result.entities?.[0]
  const reused = Boolean(result.reused ?? (result.data as { reused?: boolean } | undefined)?.reused)
  const verified = Boolean(result.verified)
  const ambiguous = Boolean(result.ambiguous)
  if (!result.ok) {
    return {
      success: false,
      action: actionType,
      entity: entity?.type,
      entityId: entity?.id,
      verified: false,
      reused,
      ambiguous,
      error: {
        code: result.code ?? (ambiguous ? 'ambiguous_target' : 'action_failed'),
        message: result.summary || 'Action did not complete',
      },
      data: asRecord(result.data),
    }
  }
  return {
    success: true,
    action: actionType,
    entity: entity?.type,
    entityId: entity?.id,
    verified,
    reused,
    data: asRecord(result.data),
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Count real mutations (excludes reused / unverified soft-success). */
export function countAuthoritativeSuccesses(
  results: Array<{
    success: boolean
    data?: unknown
    summary?: string
  }>,
) {
  let createdOrMutated = 0
  let reused = 0
  let failed = 0
  for (const result of results) {
    if (!result.success) {
      failed += 1
      continue
    }
    const data = result.data as { reused?: boolean; items?: Array<{ ok: boolean; reused?: boolean }> } | undefined
    if (Array.isArray(data?.items)) {
      for (const item of data.items) {
        if (!item.ok) failed += 1
        else if (item.reused) reused += 1
        else createdOrMutated += 1
      }
      continue
    }
    if (data?.reused) reused += 1
    else createdOrMutated += 1
  }
  return { createdOrMutated, reused, failed }
}

export function summarizeBatchOutcome(input: {
  createdOrMutated: number
  reused: number
  failed: number
  verb?: string
}) {
  const verb = input.verb ?? 'completed'
  const total = input.createdOrMutated + input.reused + input.failed
  if (total === 0) return 'No actions were applied.'
  if (input.failed === 0 && input.reused === 0) {
    return input.createdOrMutated === 1
      ? `Successfully ${verb} 1 action.`
      : `Successfully ${verb} ${input.createdOrMutated} actions.`
  }
  if (input.failed === 0 && input.createdOrMutated === 0 && input.reused > 0) {
    return input.reused === 1
      ? 'No new task was created — that task already exists.'
      : `No new tasks were created — ${input.reused} already existed.`
  }
  const parts: string[] = []
  if (input.createdOrMutated) parts.push(`${input.createdOrMutated} succeeded`)
  if (input.reused) parts.push(`${input.reused} already existed`)
  if (input.failed) parts.push(`${input.failed} failed`)
  return parts.join(', ') + '.'
}
