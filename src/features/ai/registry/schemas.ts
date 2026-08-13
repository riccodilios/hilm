import { z } from 'zod'
import { PRIORITIES, TASK_STATUSES, type Priority, type TaskStatus } from '@/types/domain'

export const uuidLoose = z
  .string()
  .trim()
  .refine(
    (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    { message: 'Invalid id' },
  )

export const optionalUuid = z.preprocess((value) => {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') return undefined
  return uuidLoose.safeParse(value.trim()).success ? value.trim() : undefined
}, uuidLoose.optional())

export const requiredUuid = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  return value.trim()
}, uuidLoose)

/** Workspace task UUID, short ref (IMED-24), or title used for resolution. */
export const taskIdOrRef = z
  .string()
  .trim()
  .min(1, { message: 'taskId is required' })
  .max(500)

/** Canonical enums — single source of truth from `@/types/domain` (+ DB task_status). */
export const taskStatusEnum = z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]])
export const priorityEnum = z.enum(PRIORITIES as [Priority, ...Priority[]])

const TASK_STATUS_ALIASES: Record<string, TaskStatus> = {
  backlog: 'backlog',
  todo: 'todo',
  to_do: 'todo',
  open: 'todo',
  not_started: 'todo',
  new: 'todo',
  in_progress: 'in_progress',
  inprogress: 'in_progress',
  doing: 'in_progress',
  started: 'in_progress',
  wip: 'in_progress',
  waiting: 'waiting',
  on_hold: 'waiting',
  hold: 'waiting',
  pending: 'waiting',
  testing: 'testing',
  test: 'testing',
  qa: 'testing',
  review: 'testing',
  in_review: 'testing',
  done: 'done',
  complete: 'done',
  completed: 'done',
  finished: 'done',
  finish: 'done',
  closed: 'done',
  archived: 'archived',
  archive: 'archived',
}

const PRIORITY_ALIASES: Record<string, Priority> = {
  none: 'none',
  no: 'none',
  unset: 'none',
  normal: 'medium',
  med: 'medium',
  medium: 'medium',
  low: 'low',
  high: 'high',
  urgent: 'urgent',
  critical: 'urgent',
  asap: 'urgent',
}

function slugKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/** Map NL / LLM status labels onto canonical Hilm TaskStatus. Unknown → undefined. */
export function normalizeTaskStatus(value: unknown): TaskStatus | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const key = slugKey(trimmed)
  if ((TASK_STATUSES as string[]).includes(key)) return key as TaskStatus
  return TASK_STATUS_ALIASES[key]
}

/** Map NL / LLM priority labels onto canonical Hilm Priority. Unknown → undefined. */
export function normalizePriority(value: unknown): Priority | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const key = slugKey(trimmed)
  if ((PRIORITIES as string[]).includes(key)) return key as Priority
  return PRIORITY_ALIASES[key]
}

/**
 * Optional status for create/update payloads.
 * Empty → omitted (app default). Known aliases → canonical. Unknown non-empty → validation error.
 */
export const optionalTaskStatus = z.preprocess((value) => {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') return value
  const normalized = normalizeTaskStatus(value)
  if (normalized) return normalized
  // Preserve raw so the enum fails with a clear path (caller may also use custom message).
  return slugKey(value)
}, taskStatusEnum.optional())

export const requiredTaskStatus = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  return normalizeTaskStatus(value) ?? slugKey(value)
}, taskStatusEnum)

export const optionalPriority = z.preprocess((value) => {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') return value
  const normalized = normalizePriority(value)
  if (normalized) return normalized
  return slugKey(value)
}, priorityEnum.optional())

/** Shared create fields — used by task.create and each task.create_many item. */
export const taskCreateFieldsSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: optionalPriority,
  status: optionalTaskStatus,
  dueAt: z.string().optional(),
  assigneeId: optionalUuid,
  departmentId: optionalUuid,
  teamId: optionalUuid,
  clientKey: z.string().optional(),
})

export type TaskCreateFields = z.infer<typeof taskCreateFieldsSchema>

export const healthEnum = z.enum([
  'unengaged',
  'started',
  'active',
  'healthy',
  'near_completion',
  'blocked',
  'stalled',
  'warning',
  'critical',
])

export const snakeToCamel: Record<string, string> = {
  project_id: 'projectId',
  project_name: 'projectName',
  task_id: 'taskId',
  due_at: 'dueAt',
  completion_pct: 'completionPct',
  log_date: 'logDate',
  worked_on: 'workedOn',
  ai_summary: 'aiSummary',
  entity_type: 'entityType',
  entity_id: 'entityId',
  assignee_id: 'assigneeId',
  label_id: 'labelId',
  label_ids: 'labelIds',
  department_id: 'departmentId',
  team_id: 'teamId',
  parent_id: 'parentId',
  lead_user_id: 'leadUserId',
}

function unwrapId(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'id' in value) {
    return (value as { id: unknown }).id
  }
  return value
}

function normalizeRecordStatusPriority(record: Record<string, unknown>) {
  if ('status' in record) {
    const status = normalizeTaskStatus(record.status)
    if (status) record.status = status
    else if (record.status == null || record.status === '') delete record.status
  }
  if ('priority' in record) {
    const priority = normalizePriority(record.priority)
    if (priority) record.priority = priority
    else if (record.priority == null || record.priority === '') delete record.priority
  }
}

export function normalizeAiAction(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const input = raw as Record<string, unknown>
  const out: Record<string, unknown> = { ...input }

  // Common LLM shapes: { action: "task.create" } or nested { taskId: { id: "..." } }
  if (typeof out.type !== 'string' && typeof out.action === 'string') {
    out.type = out.action
  }
  if (typeof out.type === 'string') out.type = out.type.trim()

  for (const [snake, camel] of Object.entries(snakeToCamel)) {
    if (snake in out && !(camel in out)) out[camel] = out[snake]
  }

  for (const key of [
    'taskId',
    'projectId',
    'subtaskId',
    'labelId',
    'assigneeId',
    'departmentId',
    'teamId',
    'entityId',
    'parentId',
    'leadUserId',
  ] as const) {
    if (key in out) out[key] = unwrapId(out[key])
  }

  if (typeof out.labelIds === 'string') {
    out.labelIds = out.labelIds
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean)
  } else if (Array.isArray(out.labelIds)) {
    out.labelIds = out.labelIds.map((item) => unwrapId(item))
  }

  normalizeRecordStatusPriority(out)

  if (Array.isArray(out.items)) {
    out.items = out.items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const next = { ...(item as Record<string, unknown>) }
      for (const [snake, camel] of Object.entries(snakeToCamel)) {
        if (snake in next && !(camel in next)) next[camel] = next[snake]
      }
      for (const key of ['assigneeId', 'departmentId', 'teamId', 'projectId'] as const) {
        if (key in next) next[key] = unwrapId(next[key])
      }
      normalizeRecordStatusPriority(next)
      if (typeof next.title !== 'string' && typeof next.name === 'string') {
        next.title = next.name
      }
      return next
    })
  }

  // title/name swaps the models often confuse
  if (typeof out.type === 'string') {
    if (
      (out.type === 'task.create' ||
        out.type === 'task.create_many' ||
        out.type === 'subtask.create' ||
        out.type === 'note.create' ||
        out.type === 'idea.create' ||
        out.type === 'roadmap.create') &&
      typeof out.title !== 'string' &&
      typeof out.name === 'string'
    ) {
      out.title = out.name
    }
    if (
      (out.type === 'project.create' || out.type === 'label.create' || out.type === 'label.apply_named') &&
      typeof out.name !== 'string' &&
      typeof out.title === 'string'
    ) {
      out.name = out.title
    }
  }

  return out
}
