/** Workspace OS short task IDs (e.g. IMED-24). Personal OS must not import this for its own IDs. */

const SHORT_ID_RE = /^([A-Za-z][A-Za-z0-9]{1,11})-(\d+)$/

export function formatWorkspaceTaskRef(
  taskKey: string | null | undefined,
  taskNumber: number | null | undefined,
): string | null {
  if (!taskKey || taskNumber == null || !Number.isFinite(taskNumber)) return null
  return `${taskKey}-${taskNumber}`
}

export function parseWorkspaceTaskRef(
  value: string,
): { key: string; number: number } | null {
  const trimmed = value.trim()
  const match = SHORT_ID_RE.exec(trimmed)
  if (!match) return null
  const number = Number(match[2])
  if (!Number.isInteger(number) || number < 1) return null
  return { key: match[1]!.toUpperCase(), number }
}

export function looksLikeWorkspaceTaskRef(value: string) {
  return parseWorkspaceTaskRef(value) != null
}

export function matchesWorkspaceTaskRef(
  query: string,
  taskKey: string | null | undefined,
  taskNumber: number | null | undefined,
) {
  const q = query.trim().toLowerCase()
  if (!q) return false
  const ref = formatWorkspaceTaskRef(taskKey, taskNumber)
  if (!ref) return false
  if (ref.toLowerCase() === q) return true
  if (ref.toLowerCase().includes(q)) return true
  const parsed = parseWorkspaceTaskRef(query)
  if (parsed && taskKey && parsed.key === taskKey.toUpperCase() && parsed.number === taskNumber) {
    return true
  }
  return String(taskNumber ?? '').toLowerCase() === q
}

/** Stored mention token: @{userId} — display names resolved at render time. */
export const MENTION_TOKEN_RE = /@\{([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\}/gi

export function extractMentionUserIds(content: string): string[] {
  const ids = new Set<string>()
  for (const match of content.matchAll(MENTION_TOKEN_RE)) {
    if (match[1]) ids.add(match[1].toLowerCase())
  }
  return [...ids]
}

export function renderMentionContent(
  content: string,
  nameById: Record<string, string>,
): Array<{ type: 'text'; value: string } | { type: 'mention'; userId: string; label: string }> {
  const parts: Array<
    { type: 'text'; value: string } | { type: 'mention'; userId: string; label: string }
  > = []
  let last = 0
  const re = new RegExp(MENTION_TOKEN_RE.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    if (match.index > last) {
      parts.push({ type: 'text', value: content.slice(last, match.index) })
    }
    const userId = match[1]!
    parts.push({
      type: 'mention',
      userId,
      label: nameById[userId] ?? nameById[userId.toLowerCase()] ?? 'member',
    })
    last = match.index + match[0].length
  }
  if (last < content.length) parts.push({ type: 'text', value: content.slice(last) })
  if (!parts.length) parts.push({ type: 'text', value: content })
  return parts
}

export function plainTextFromMentionContent(
  content: string,
  nameById: Record<string, string>,
) {
  return renderMentionContent(content, nameById)
    .map((part) => (part.type === 'mention' ? `@${part.label}` : part.value))
    .join('')
}
