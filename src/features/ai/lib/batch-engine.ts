import type { ParsedRegistryAction } from '@/features/ai/registry/types'

export const WORKSPACE_BATCH_CREATE_THRESHOLD = 4
export const WORKSPACE_BATCH_MAX_ITEMS = 40
export const WORKSPACE_BATCH_DEFAULT_CONCURRENCY = 4

export type BatchItemResult = {
  index: number
  title: string
  ok: boolean
  summary: string
  taskId?: string
  taskRef?: string
  error?: string
}

export type CreateManyPayload = {
  type: 'task.create_many'
  projectId?: string
  projectName?: string
  items: Array<{
    title: string
    description?: string
    priority?: string
    status?: string
    dueAt?: string
    assigneeId?: string
    departmentId?: string
    teamId?: string
    clientKey?: string
  }>
}

function projectKey(action: ParsedRegistryAction) {
  const id = typeof action.projectId === 'string' ? action.projectId : ''
  const name = typeof action.projectName === 'string' ? action.projectName.trim().toLowerCase() : ''
  return `${id}::${name}`
}

/**
 * Collapse many workspace task.create actions into task.create_many
 * so project resolution + execution run as one recoverable batch.
 * Personal OS actions are left unchanged.
 */
export function coalesceWorkspaceTaskCreates(
  actions: ParsedRegistryAction[],
  opts?: { threshold?: number; maxItems?: number },
): ParsedRegistryAction[] {
  const threshold = opts?.threshold ?? WORKSPACE_BATCH_CREATE_THRESHOLD
  const maxItems = opts?.maxItems ?? WORKSPACE_BATCH_MAX_ITEMS
  const creates = actions.filter((action) => action.type === 'task.create')
  if (creates.length < threshold) return actions

  const other = actions.filter((action) => action.type !== 'task.create')
  const groups = new Map<string, ParsedRegistryAction[]>()
  for (const action of creates) {
    const key = projectKey(action)
    const list = groups.get(key) ?? []
    list.push(action)
    groups.set(key, list)
  }

  const batches: ParsedRegistryAction[] = []
  for (const group of groups.values()) {
    for (let offset = 0; offset < group.length; offset += maxItems) {
      const slice = group.slice(offset, offset + maxItems)
      const first = slice[0]!
      const items = slice.map((action, index) => ({
        title: String(action.title ?? '').trim(),
        description: typeof action.description === 'string' ? action.description : undefined,
        priority: typeof action.priority === 'string' ? action.priority : undefined,
        status: typeof action.status === 'string' ? action.status : undefined,
        dueAt:
          typeof action.dueAt === 'string'
            ? action.dueAt
            : typeof action.due_at === 'string'
              ? action.due_at
              : undefined,
        assigneeId: typeof action.assigneeId === 'string' ? action.assigneeId : undefined,
        departmentId: typeof action.departmentId === 'string' ? action.departmentId : undefined,
        teamId: typeof action.teamId === 'string' ? action.teamId : undefined,
        clientKey: `create:${index + offset}:${String(action.title ?? '').trim().toLowerCase()}`,
      }))
      batches.push({
        type: 'task.create_many',
        projectId: typeof first.projectId === 'string' ? first.projectId : undefined,
        projectName: typeof first.projectName === 'string' ? first.projectName : undefined,
        items: items.filter((item) => item.title),
      })
    }
  }

  return [...other, ...batches]
}

/** Expand create_many into per-item UI rows while keeping one executable action. */
export function expandCreateManyForDisplay(action: ParsedRegistryAction): Array<{
  key: string
  label: string
  index: number
}> {
  if (action.type !== 'task.create_many' || !Array.isArray(action.items)) {
    return []
  }
  return action.items.map((item, index) => {
    const title =
      item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string'
        ? (item as { title: string }).title
        : `Task ${index + 1}`
    return {
      key: `create-many-${index}`,
      label: title,
      index,
    }
  })
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onItem?: (result: R, index: number) => void,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1))
  const results = new Array<R>(items.length)
  let next = 0

  async function run() {
    while (next < items.length) {
      const index = next
      next += 1
      const result = await worker(items[index]!, index)
      results[index] = result
      onItem?.(result, index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()))
  return results
}
