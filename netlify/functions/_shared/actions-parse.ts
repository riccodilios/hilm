/** Shared actions JSON extraction for Netlify + Edge AI chat. */

export type ActionsParseResult = {
  actions: unknown[]
  truncated: boolean
  parseError?: string
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}

function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray((value as { actions?: unknown }).actions)) {
    return (value as { actions: unknown[] }).actions
  }
  return null
}

export function repairJsonActionsArray(raw: string): unknown[] | null {
  let text = raw.trim()
  if (!text) return null
  const direct = tryParse(text)
  if (direct.ok) return asArray(direct.value)

  text = text.replace(/,\s*$/, '')
  const quoteCount = (text.match(/(?<!\\)"/g) ?? []).length
  if (quoteCount % 2 === 1) text += '"'
  const lastBrace = text.lastIndexOf('}')
  if (lastBrace >= 0) text = text.slice(0, lastBrace + 1)
  text = text.replace(/,\s*$/, '')
  if (!text.startsWith('[')) text = `[${text}`
  if (!text.endsWith(']')) text = `${text}]`
  const repaired = tryParse(text)
  if (repaired.ok) return asArray(repaired.value)
  return null
}

export function actionsFromContent(content: string): ActionsParseResult {
  const closed =
    content.match(/```actions(?:\s+json)?\s*\n([\s\S]*?)```/i) ||
    content.match(/```json\s*\n(\[[\s\S]*?\])\s*```/i)
  const open = content.match(/```actions(?:\s+json)?\s*\n([\s\S]*)$/i)
  const body = closed?.[1]
    ? closed[1]
    : open?.[1] && !/```/.test(open[1])
      ? open[1]
      : null
  const closedFence = Boolean(closed?.[1])

  if (!body) return { actions: [], truncated: false }

  const direct = tryParse(body.trim())
  if (direct.ok) {
    return { actions: asArray(direct.value) ?? [], truncated: !closedFence }
  }

  const repaired = repairJsonActionsArray(body)
  if (repaired?.length) {
    return { actions: repaired, truncated: true, parseError: direct.error }
  }

  return {
    actions: [],
    truncated: !closedFence,
    parseError: direct.error,
  }
}
