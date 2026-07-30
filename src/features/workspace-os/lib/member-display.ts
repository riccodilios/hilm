/** Human-facing label for a workspace member. Never returns a UUID. */
export function resolveMemberDisplayName(input: {
  displayNameOverride?: string | null
  displayName?: string | null
  fullName?: string | null
  username?: string | null
  email?: string | null
}): string {
  const candidates = [
    input.displayNameOverride,
    input.displayName,
    input.fullName,
    input.username,
    input.email,
  ]
  for (const value of candidates) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return 'Unnamed User'
}

export function memberInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length || name === 'Unnamed User') return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

const ACTIVE_MS = 15 * 60 * 1000

export function memberPresenceLabel(
  lastActiveAt: string | null | undefined,
  joinedAt: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (lastActiveAt) {
    const at = new Date(lastActiveAt).getTime()
    if (Number.isFinite(at) && Date.now() - at < ACTIVE_MS) {
      return t('workspace.activeNow')
    }
    return t('workspace.lastActiveAt', { date: new Date(lastActiveAt) })
  }
  return t('workspace.joinedAt', { date: new Date(joinedAt) })
}
