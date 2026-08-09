import {
  focusTaskId,
  messageLooksLikeCreate,
  messageLooksLikeEdit,
  type ConversationEntityFocus,
} from '@/features/ai/lib/conversation-focus'
import type { ParsedRegistryAction } from '@/features/ai/registry/types'

/**
 * Rewrite create→update (and fill missing taskIds) when conversation focus
 * makes the user's intent clearly a modification of an existing task.
 */
export function rewriteActionsForConversationFocus(
  actions: ParsedRegistryAction[],
  opts: {
    userMessage?: string
    focus?: ConversationEntityFocus | null
  },
): ParsedRegistryAction[] {
  const focus = opts.focus ?? {}
  const focusedId = focusTaskId(focus)
  const message = opts.userMessage?.trim() ?? ''
  const preferUpdate = Boolean(focusedId) && (messageLooksLikeEdit(message) || !messageLooksLikeCreate(message))

  return actions.map((action) => {
    const type = typeof action.type === 'string' ? action.type : ''
    if (!type) return action

    if (
      type === 'task.create' &&
      preferUpdate &&
      focusedId &&
      !messageLooksLikeCreate(message)
    ) {
      const title = typeof action.title === 'string' ? action.title : undefined
      const description = typeof action.description === 'string' ? action.description : undefined
      const priority = action.priority
      const dueAt = action.dueAt ?? action.due_at
      const next: ParsedRegistryAction = {
        type: dueAt && !title && !description ? 'task.schedule' : 'task.update',
        taskId: focusedId,
      }
      if (title) next.title = title
      if (description) next.description = description
      if (priority != null) next.priority = priority
      if (dueAt != null) next.dueAt = dueAt
      return next
    }

    if (
      (type === 'task.update' ||
        type === 'task.schedule' ||
        type === 'task.move' ||
        type === 'task.complete' ||
        type === 'task.assign' ||
        type === 'subtask.create') &&
      focusedId
    ) {
      const taskId = typeof action.taskId === 'string' ? action.taskId : ''
      const looksFake =
        !taskId ||
        taskId === 'null' ||
        taskId === 'undefined' ||
        taskId.includes('example') ||
        taskId.includes('TODO')
      if (looksFake) {
        return { ...action, taskId: focusedId }
      }
    }

    return action
  })
}
