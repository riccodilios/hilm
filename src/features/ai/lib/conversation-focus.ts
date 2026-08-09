/** Conversation-scoped entity focus for AI follow-up updates (not creates). */

export type ConversationEntityFocus = {
  lastCreatedTaskId?: string | null
  lastModifiedTaskId?: string | null
  lastReferencedProjectId?: string | null
  lastReferencedWorkspaceId?: string | null
  lastTaskTitle?: string | null
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
  const next: ConversationEntityFocus = {
    ...readConversationFocus(conversationId),
    ...patch,
    updatedAt: new Date().toISOString(),
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

export function focusTaskId(focus: ConversationEntityFocus) {
  return focus.lastModifiedTaskId || focus.lastCreatedTaskId || null
}

export function formatFocusForPrompt(focus: ConversationEntityFocus) {
  const lines: string[] = []
  if (focus.lastCreatedTaskId) lines.push(`lastCreatedTaskId=${focus.lastCreatedTaskId}`)
  if (focus.lastModifiedTaskId) lines.push(`lastModifiedTaskId=${focus.lastModifiedTaskId}`)
  if (focus.lastTaskTitle) lines.push(`lastTaskTitle=${JSON.stringify(focus.lastTaskTitle)}`)
  if (focus.lastReferencedProjectId) lines.push(`lastReferencedProjectId=${focus.lastReferencedProjectId}`)
  if (focus.lastReferencedWorkspaceId) {
    lines.push(`lastReferencedWorkspaceId=${focus.lastReferencedWorkspaceId}`)
  }
  if (!lines.length) return ''
  return `Conversation focus (prefer these IDs for follow-ups — UPDATE existing entities, do not recreate):
${lines.join('\n')}`
}

const CREATE_HINT =
  /\b(create|add|new|make a|make an|start a|start an|open a|open an)\b/i
const EDIT_HINT =
  /\b(update|edit|change|rename|shorten|longer|move|reschedule|set|make (it|the|this|that)|put|add (more |the )?detail|description|title|due|priority|assign|label|complete|finish|archive|delete|remove)\b/i
const REF_HINT =
  /\b(it|that|this|the task|the one|previous|just created|i just|we just)\b/i

export function messageLooksLikeCreate(message: string) {
  return CREATE_HINT.test(message) && !EDIT_HINT.test(message)
}

export function messageLooksLikeEdit(message: string) {
  if (EDIT_HINT.test(message)) return true
  if (REF_HINT.test(message) && !messageLooksLikeCreate(message)) return true
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
