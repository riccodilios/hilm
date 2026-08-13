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

/**
 * Resolve a workspace task by UUID, short ID (IMED-24), or exact/fuzzy title.
 * Short IDs always win deterministically — never fuzzy-matched as titles.
 * Scoped to the current workspace only.
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

  // 1) Explicit short ID (KEY-number) — deterministic
  const refRaw = opts?.taskRef?.trim() || opts?.taskId?.trim() || ''
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
  if (opts?.taskId) {
    const byUuid = findById(opts.taskId)
    if (byUuid) return { ok: true, task: byUuid }
    // If it looked like a UUID but missing, don't fall through to title with the UUID string
    if (/^[0-9a-f-]{36}$/i.test(opts.taskId)) {
      return { ok: false, reason: 'That task was not found in this workspace.' }
    }
  }

  // 3) Conversation focus
  if (opts?.preferTaskId) {
    const preferred = findById(opts.preferTaskId)
    if (preferred) return { ok: true, task: preferred }
  }

  // 4) Title match within workspace
  const title = opts?.title?.trim()
  if (title) {
    const exact = tasks.filter(
      (task) => task.title.trim().toLowerCase() === title.toLowerCase(),
    )
    if (exact.length === 1) return { ok: true, task: exact[0]! }
    if (exact.length > 1) {
      return {
        ok: false,
        reason: `Multiple tasks are titled “${title}”. Use the short ID (e.g. ${workspace.task_key}-12).`,
      }
    }
    const partial = tasks.filter((task) =>
      task.title.toLowerCase().includes(title.toLowerCase()),
    )
    if (partial.length === 1) return { ok: true, task: partial[0]! }
    if (partial.length > 1) {
      return {
        ok: false,
        reason: `Several tasks match “${title}”. Use the short ID instead.`,
      }
    }
    return { ok: false, reason: `I couldn’t find a task matching “${title}”.` }
  }

  return {
    ok: false,
    reason: `Which task should I use? Reference it by short ID (e.g. ${workspace.task_key}-12).`,
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
