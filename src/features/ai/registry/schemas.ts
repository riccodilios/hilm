import { z } from 'zod'

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

export const priorityEnum = z.enum(['none', 'low', 'medium', 'high', 'urgent'])
export const taskStatusEnum = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'waiting',
  'testing',
  'done',
  'archived',
])

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

  // title/name swaps the models often confuse
  if (typeof out.type === 'string') {
    if (
      (out.type === 'task.create' ||
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
