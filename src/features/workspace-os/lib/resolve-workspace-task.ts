import {
  getWorkspace,
  getWorkspaceTask,
  listWorkspaceTasks,
  type WorkspaceTask,
} from '@/features/workspace-os/api'
import {
  looksLikeWorkspaceTaskRef,
  parseWorkspaceTaskRef,
} from '@/features/workspace-os/lib/task-refs'

export type WorkspaceTaskResolveResult =
  | { ok: true; task: WorkspaceTask }
  | { ok: false; reason: string }

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  )
}

function matchTitle(tasks: WorkspaceTask[], title: string, taskKey: string): WorkspaceTaskResolveResult {
  const needle = title.trim().toLowerCase()
  if (!needle) {
    return {
      ok: false,
      reason: `Which task should I use? Reference it by short ID (e.g. ${taskKey}-12).`,
    }
  }

  const exact = tasks.filter((task) => task.title.trim().toLowerCase() === needle)
  if (exact.length === 1) return { ok: true, task: exact[0]! }
  if (exact.length > 1) {
    return {
      ok: false,
      reason: `Multiple tasks are titled “${title.trim()}”. Use the short ID (e.g. ${taskKey}-12).`,
    }
  }

  const partial = tasks.filter((task) => task.title.toLowerCase().includes(needle))
  if (partial.length === 1) return { ok: true, task: partial[0]! }
  if (partial.length > 1) {
    const refs = partial
      .slice(0, 5)
      .map((task) => `${taskKey}-${task.task_number}`)
      .join(', ')
    return {
      ok: false,
      reason: `Several tasks match “${title.trim()}” (${refs}). Use the short ID.`,
    }
  }

  return { ok: false, reason: `I couldn’t find a task matching “${title.trim()}”.` }
}

/**
 * Resolve a workspace task by UUID, short ID (IMED-24), or title.
 * Short IDs always win deterministically — never fuzzy-matched as titles.
 * Scoped to the current workspace only.
 *
 * Order:
 * 1. KEY-N short ref
 * 2. UUID
 * 3. Title (explicit title OR non-uuid/non-ref taskId string)
 * 4. Conversation focus preferTaskId (only when no identifier was provided)
 */
export async function resolveWorkspaceTaskForAction(
  workspaceId: string,
  opts?: {
    taskId?: string | null
    taskRef?: string | null
    title?: string | null
    preferTaskId?: string | null
  },
): Promise<WorkspaceTaskResolveResult> {
  const workspace = await getWorkspace(workspaceId)
  const tasks = await listWorkspaceTasks(workspaceId)
  if (!tasks.length) {
    return { ok: false, reason: 'This workspace has no tasks yet.' }
  }

  const findById = (id: string | null | undefined) =>
    id ? tasks.find((task) => task.id === id) ?? null : null

  const refRaw = (opts?.taskRef ?? opts?.taskId ?? '').trim()
  const taskIdRaw = (opts?.taskId ?? '').trim()
  const titleHint = (opts?.title ?? '').trim()

  // 1) Explicit short ID (KEY-number) — deterministic
  if (refRaw && looksLikeWorkspaceTaskRef(refRaw)) {
    const parsed = parseWorkspaceTaskRef(refRaw)!
    if (parsed.key !== workspace.task_key.toUpperCase()) {
      return {
        ok: false,
        reason: `Task ${refRaw.toUpperCase()} does not belong to this workspace (${workspace.task_key}).`,
      }
    }
    const byNumber = tasks.find((task) => task.task_number === parsed.number)
    if (byNumber) return { ok: true, task: byNumber }
    return { ok: false, reason: `I couldn’t find ${refRaw.toUpperCase()} in this workspace.` }
  }

  // 2) UUID
  if (taskIdRaw && isUuid(taskIdRaw)) {
    const byUuid = findById(taskIdRaw)
    if (byUuid) return { ok: true, task: byUuid }
    return { ok: false, reason: 'That task was not found in this workspace.' }
  }

  // 3) Title — from explicit title, or taskId when the model stuffed a title into taskId
  const titleCandidate = titleHint || (!isUuid(taskIdRaw) && !looksLikeWorkspaceTaskRef(taskIdRaw) ? taskIdRaw : '')
  if (titleCandidate) {
    return matchTitle(tasks, titleCandidate, workspace.task_key)
  }

  // 4) Conversation focus — only when the model gave no identifier
  if (opts?.preferTaskId) {
    const preferred = findById(opts.preferTaskId)
    if (preferred) return { ok: true, task: preferred }
  }

  return {
    ok: false,
    reason: `Which task should I use? Reference it by short ID (e.g. ${workspace.task_key}-12) or exact title.`,
  }
}

export async function resolveWorkspaceTaskRefToId(
  workspaceId: string,
  taskRefOrId: string,
): Promise<string | null> {
  const direct = await getWorkspaceTask(workspaceId, taskRefOrId).catch(() => null)
  if (direct) return direct.id
  const resolved = await resolveWorkspaceTaskForAction(workspaceId, {
    taskId: taskRefOrId,
    taskRef: taskRefOrId,
  })
  return resolved.ok ? resolved.task.id : null
}
