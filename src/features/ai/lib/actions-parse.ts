/**
 * Recover executable actions from AI markdown when the model truncates
 * or leaves the ```actions fence unclosed — the main failure mode for 10+ batches.
 */

export type ActionsParseResult = {
  actions: unknown[]
  truncated: boolean
  parseError?: string
  rawPreview?: string
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}

function asActionsArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray((value as { actions?: unknown }).actions)) {
    return (value as { actions: unknown[] }).actions
  }
  return null
}

/** Best-effort repair of a truncated JSON array of objects. */
export function repairJsonActionsArray(raw: string): unknown[] | null {
  let text = raw.trim()
  if (!text) return null

  const direct = tryParseJson(text)
  if (direct.ok) return asActionsArray(direct.value)

  // Strip trailing incomplete token / string / object.
  text = text.replace(/,\s*$/, '')

  // Close an open string if the last quote is unmatched (naive).
  const quoteCount = (text.match(/(?<!\\)"/g) ?? []).length
  if (quoteCount % 2 === 1) text += '"'

  // Drop a trailing incomplete object: keep through last complete `}`
  const lastBrace = text.lastIndexOf('}')
  if (lastBrace >= 0) {
    text = text.slice(0, lastBrace + 1)
  }

  text = text.replace(/,\s*$/, '')
  if (!text.startsWith('[')) text = `[${text}`
  if (!text.endsWith(']')) text = `${text}]`

  const repaired = tryParseJson(text)
  if (repaired.ok) return asActionsArray(repaired.value)
  return null
}

function extractFenceBodies(content: string): Array<{ body: string; closed: boolean }> {
  const bodies: Array<{ body: string; closed: boolean }> = []
  const closed =
    content.match(/```actions(?:\s+json)?\s*\n([\s\S]*?)```/i) ||
    content.match(/```json\s*\n(\[[\s\S]*?\])\s*```/i)
  if (closed?.[1]) bodies.push({ body: closed[1], closed: true })

  // Unclosed fence at end of stream (common when max_tokens / timeout cuts mid-JSON).
  const open = content.match(/```actions(?:\s+json)?\s*\n([\s\S]*)$/i)
  if (open?.[1] && !/```/.test(open[1])) {
    bodies.push({ body: open[1], closed: false })
  }
  return bodies
}

export function parseActionsFromAssistantContent(content: string): ActionsParseResult {
  const fences = extractFenceBodies(content)
  if (!fences.length) {
    return { actions: [], truncated: false }
  }

  // Prefer the last actions fence (models sometimes revise).
  const fence = fences[fences.length - 1]!
  const preview = fence.body.trim().slice(0, 240)

  const direct = tryParseJson(fence.body.trim())
  if (direct.ok) {
    const actions = asActionsArray(direct.value) ?? []
    return {
      actions,
      truncated: !fence.closed,
      rawPreview: preview,
    }
  }

  const repaired = repairJsonActionsArray(fence.body)
  if (repaired?.length) {
    return {
      actions: repaired,
      truncated: true,
      parseError: direct.error,
      rawPreview: preview,
    }
  }

  return {
    actions: [],
    truncated: !fence.closed,
    parseError: direct.error,
    rawPreview: preview,
  }
}
