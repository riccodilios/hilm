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

    // Workspace: when creating another task "for it" / same project, prefer focus project IDs.
    // Never invent IDs here — only reuse lastReferencedProjectId from prior successful actions.
    // Do not override when the model already provided a projectName (name resolution wins).
    if (type === 'task.create' && focus.lastReferencedProjectId) {
      const projectId = typeof action.projectId === 'string' ? action.projectId : ''
      const projectName =
        typeof action.projectName === 'string'
          ? action.projectName.trim()
          : typeof action.project_name === 'string'
            ? action.project_name.trim()
            : ''
      if (projectName) return action

      const looksFakeProjectId =
        !projectId ||
        projectId === 'null' ||
        projectId === 'undefined' ||
        projectId.includes('example') ||
        projectId.includes('TODO')
      const referencesSameProject =
        /\b(for it|for that|same project|that project|this project|another (one|task) (for|under|in)|add another)\b/i.test(
          message,
        )
      if (!looksFakeProjectId && !referencesSameProject) return action

      const next: ParsedRegistryAction = {
        ...action,
        projectId: focus.lastReferencedProjectId,
      }
      if (focus.lastReferencedProjectName) {
        next.projectName = focus.lastReferencedProjectName
      }
      return next
    }

    return action
  })
}
