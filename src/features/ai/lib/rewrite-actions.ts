import {
  focusTaskId,
  messageLooksLikeCreate,
  messageLooksLikeEdit,
  type ConversationEntityFocus,
} from '@/features/ai/lib/conversation-focus'
import type { ParsedRegistryAction } from '@/features/ai/registry/types'

function looksFakeId(value: string) {
  return (
    !value ||
    value === 'null' ||
    value === 'undefined' ||
    value.includes('example') ||
    value.includes('TODO')
  )
}

function actionProjectName(action: ParsedRegistryAction) {
  if (typeof action.projectName === 'string' && action.projectName.trim()) {
    return action.projectName.trim()
  }
  if (typeof action.project_name === 'string' && action.project_name.trim()) {
    return action.project_name.trim()
  }
  return ''
}

/**
 * Inject lastReferencedProjectId into task.create / task.create_many when the
 * model omitted a real project id (or is clearly continuing "for it").
 */
function withFocusedProject(
  action: ParsedRegistryAction,
  focus: ConversationEntityFocus,
  message: string,
): ParsedRegistryAction {
  if (!focus.lastReferencedProjectId) return action
  const type = typeof action.type === 'string' ? action.type : ''
  if (type !== 'task.create' && type !== 'task.create_many') return action

  const projectName = actionProjectName(action)
  const focusedProjectName = focus.lastReferencedProjectName?.trim() || ''
  // Explicit different project name wins over focus.
  if (
    projectName &&
    focusedProjectName &&
    projectName.toLowerCase() !== focusedProjectName.toLowerCase()
  ) {
    return action
  }

  const projectId = typeof action.projectId === 'string' ? action.projectId : ''
  const looksFakeProjectId = looksFakeId(projectId)
  const referencesSameProject =
    /\b(for it|for that|same project|that project|this project|another (one|task) (for|under|in)|add another|add these|inside it|to it)\b/i.test(
      message,
    )
  const nameMatchesFocus =
    Boolean(projectName) &&
    Boolean(focusedProjectName) &&
    projectName.toLowerCase() === focusedProjectName.toLowerCase()

  // Inject focus project when id is missing/fake, user refers to "it", or name matches focus.
  if (!looksFakeProjectId && !referencesSameProject && !nameMatchesFocus) {
    return action
  }

  const next: ParsedRegistryAction = {
    ...action,
    projectId: focus.lastReferencedProjectId,
  }
  if (focus.lastReferencedProjectName) {
    next.projectName = focus.lastReferencedProjectName
  }
  return next
}

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
      if (looksFakeId(taskId)) {
        return { ...action, taskId: focusedId }
      }
    }

    return withFocusedProject(action, focus, message)
  })
}

/**
 * After a successful project.create in a multi-step plan, stamp the new project
 * id onto following task creates that target the same name (or omit project).
 */
export function applyCreatedProjectToFollowingActions(
  actions: ParsedRegistryAction[],
  created: { projectId: string; projectName: string },
  fromIndex: number,
): void {
  const createdName = created.projectName.trim().toLowerCase()
  for (let i = fromIndex + 1; i < actions.length; i++) {
    const action = actions[i]
    if (!action) continue
    const type = typeof action.type === 'string' ? action.type : ''
    if (type !== 'task.create' && type !== 'task.create_many') continue

    const projectName = actionProjectName(action)
    const projectId = typeof action.projectId === 'string' ? action.projectId : ''
    const nameOk = !projectName || projectName.toLowerCase() === createdName
    if (!nameOk) continue
    if (!looksFakeId(projectId) && projectId !== created.projectId) continue

    action.projectId = created.projectId
    action.projectName = created.projectName
  }
}
