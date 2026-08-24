/** Conversation-scoped entity focus for AI follow-up updates (not creates). */

export type ConversationEntityFocus = {
  lastCreatedTaskId?: string | null
  lastModifiedTaskId?: string | null
  lastReferencedProjectId?: string | null
  lastReferencedProjectName?: string | null
  lastReferencedWorkspaceId?: string | null
  lastTaskTitle?: string | null
  lastTaskRef?: string | null
  /** Recent task titles created in this conversation (newest last). Helps avoid recreating work. */
  recentCreatedTitles?: string[] | null
  updatedAt?: string
}

const memory = new Map<string, ConversationEntityFocus>()

function storageKey(conversationId: string) {
  return `hilm:ai-focus:${conversationId}`
}

export function readConversationFocus(conversationId: string | null | undefined): ConversationEntityFocus {
  if (!conversationId) return {}
  const cached = memory.get(conversationId)
  if (cached) return cached
  if (typeof sessionStorage === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(storageKey(conversationId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ConversationEntityFocus
    memory.set(conversationId, parsed)
    return parsed
  } catch {
    return {}
  }
}

export function writeConversationFocus(
  conversationId: string | null | undefined,
  patch: ConversationEntityFocus,
) {
  if (!conversationId) return
  const prev = readConversationFocus(conversationId)
  const next: ConversationEntityFocus = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  if (patch.recentCreatedTitles?.length) {
    next.recentCreatedTitles = mergeRecentTitles(prev.recentCreatedTitles, patch.recentCreatedTitles)
  } else if (prev.recentCreatedTitles?.length) {
    next.recentCreatedTitles = prev.recentCreatedTitles
  }
  memory.set(conversationId, next)
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(storageKey(conversationId), JSON.stringify(next))
    } catch {
      /* ignore quota */
    }
  }
}

function mergeRecentTitles(
  prev: string[] | null | undefined,
  incoming: string[] | null | undefined,
) {
  if (!incoming?.length && !prev?.length) return undefined
  const out: string[] = []
  const seen = new Set<string>()
  for (const title of [...(prev ?? []), ...(incoming ?? [])]) {
    const key = title.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(title.trim())
  }
  return out.slice(-24)
}

export function focusTaskId(focus: ConversationEntityFocus) {
  return focus.lastModifiedTaskId || focus.lastCreatedTaskId || null
}

export function formatFocusForPrompt(focus: ConversationEntityFocus) {
  const lines: string[] = []
  if (focus.lastCreatedTaskId) lines.push(`lastCreatedTaskId=${focus.lastCreatedTaskId}`)
  if (focus.lastModifiedTaskId) lines.push(`lastModifiedTaskId=${focus.lastModifiedTaskId}`)
  if (focus.lastTaskTitle) lines.push(`lastTaskTitle=${JSON.stringify(focus.lastTaskTitle)}`)
  if (focus.lastTaskRef) lines.push(`lastTaskRef=${focus.lastTaskRef}`)
  if (focus.lastReferencedProjectId) lines.push(`lastReferencedProjectId=${focus.lastReferencedProjectId}`)
  if (focus.lastReferencedProjectName) {
    lines.push(`lastReferencedProjectName=${JSON.stringify(focus.lastReferencedProjectName)}`)
  }
  if (focus.lastReferencedWorkspaceId) {
    lines.push(`lastReferencedWorkspaceId=${focus.lastReferencedWorkspaceId}`)
  }
  if (focus.recentCreatedTitles?.length) {
    lines.push(`recentCreatedTitles=${JSON.stringify(focus.recentCreatedTitles.slice(-12))}`)
  }
  if (!lines.length) return ''
  return `Conversation focus (prefer these IDs for follow-ups — UPDATE existing entities, do not recreate):
${lines.join('\n')}
If a task title is already in recentCreatedTitles or the Tasks pack (especially workState=done), do not recreate it — update or skip.`
}

const CREATE_HINT =
  /\b(create|add|new|make a|make an|start a|start an|open a|open an)\b/i
const MULTI_CREATE_HINT =
  /\b(these tasks|these items|list of|batch|several|multiple|a few|another (set|batch)|also create|also add)\b/i
const EDIT_HINT =
  /\b(update|edit|change|rename|shorten|longer|move|reschedule|set|make (it|the|this|that)|put|add (more |the )?detail|description|title|due|priority|assign|label|complete|finish|archive|delete|remove)\b/i
const REF_HINT =
  /\b(it|that|this|the task|the one|previous|just created|i just|we just)\b/i

export function messageLooksLikeCreate(message: string) {
  return CREATE_HINT.test(message) && !EDIT_HINT.test(message)
}

export function messageLooksLikeMultiCreate(message: string) {
  return MULTI_CREATE_HINT.test(message)
}

export function messageLooksLikeEdit(message: string) {
  if (EDIT_HINT.test(message) && !MULTI_CREATE_HINT.test(message)) return true
  if (REF_HINT.test(message) && !messageLooksLikeCreate(message) && !MULTI_CREATE_HINT.test(message)) {
    return true
  }
  return false
}

export function auditAiAction(entry: {
  phase: string
  userRequest?: string
  intent?: string
  tool?: string
  targetId?: string | null
  params?: unknown
  result?: unknown
  error?: unknown
}) {
  if (typeof console === 'undefined') return
  try {
    console.debug('[hilm:ai-audit]', entry)
  } catch {
    /* ignore */
  }
}
