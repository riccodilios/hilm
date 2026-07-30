import { z } from 'zod'

const uuidLoose = z
  .string()
  .trim()
  .refine((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), {
    message: 'Invalid id',
  })

const optionalUuid = z.preprocess((value) => {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') return undefined
  return uuidLoose.safeParse(value.trim()).success ? value.trim() : undefined
}, uuidLoose.optional())

const requiredUuid = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  return value.trim()
}, uuidLoose)

const priorityEnum = z.enum(['none', 'low', 'medium', 'high', 'urgent'])
const taskStatusEnum = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'waiting',
  'testing',
  'done',
  'archived',
])

export const aiActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('task.complete'),
    taskId: requiredUuid,
  }),
  z.object({
    type: z.literal('task.create'),
    title: z.string().min(1),
    description: z.string().optional(),
    projectId: optionalUuid,
    priority: priorityEnum.optional(),
    status: taskStatusEnum.optional(),
    dueAt: z.string().optional(),
    assigneeId: optionalUuid,
  }),
  z.object({
    type: z.literal('task.move'),
    taskId: requiredUuid,
    status: taskStatusEnum,
  }),
  z.object({
    type: z.literal('task.update'),
    taskId: requiredUuid,
    title: z.string().optional(),
    description: z.string().optional(),
    priority: priorityEnum.optional(),
    dueAt: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('task.assign'),
    taskId: requiredUuid,
    assigneeId: requiredUuid,
  }),
  z.object({
    type: z.literal('project.create'),
    name: z.string().min(1),
    description: z.string().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
  }),
  z.object({
    type: z.literal('project.update'),
    projectId: requiredUuid,
    name: z.string().optional(),
    description: z.string().optional(),
    completionPct: z.coerce.number().min(0).max(100).optional(),
    health: z
      .enum([
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
      .optional(),
  }),
  z.object({
    type: z.literal('note.create'),
    title: z.string().min(1),
    body: z.string().optional(),
    projectId: optionalUuid,
  }),
  z.object({
    type: z.literal('roadmap.create'),
    projectId: requiredUuid,
    title: z.string().min(1),
    horizon: z.enum(['now', 'next', 'later', 'future']).optional(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('daily_log.upsert'),
    logDate: z.string().optional(),
    workedOn: z.string().optional(),
    blockers: z.string().optional(),
    hours: z.coerce.number().optional(),
    wins: z.string().optional(),
    tomorrow: z.string().optional(),
    aiSummary: z.string().optional(),
  }),
  z.object({
    type: z.literal('activity.note'),
    summary: z.string().min(1),
    entityType: z.string().optional(),
    entityId: optionalUuid,
    projectId: optionalUuid,
  }),
  z.object({
    type: z.literal('idea.create'),
    title: z.string().min(1),
    description: z.string().optional(),
    projectId: optionalUuid,
    impact: z.coerce.number().min(1).max(5).optional(),
    effort: z.coerce.number().min(1).max(5).optional(),
  }),
  z.object({
    type: z.literal('documentation.generate'),
    title: z.string().min(1),
    body: z.string().optional(),
    projectId: optionalUuid,
  }),
  z.object({
    type: z.literal('meeting.summarize'),
    title: z.string().min(1),
    summary: z.string().min(1),
    projectId: optionalUuid,
  }),
  z.object({
    type: z.literal('release.notes'),
    title: z.string().min(1),
    body: z.string().min(1),
    projectId: optionalUuid,
  }),
  z.object({
    type: z.literal('milestone.create'),
    title: z.string().min(1),
    projectId: optionalUuid,
    dueAt: z.string().optional(),
  }),
])

export type AiAction = z.infer<typeof aiActionSchema>

export const aiActionsArraySchema = z.array(aiActionSchema)

const snakeToCamel: Record<string, string> = {
  project_id: 'projectId',
  task_id: 'taskId',
  due_at: 'dueAt',
  completion_pct: 'completionPct',
  log_date: 'logDate',
  worked_on: 'workedOn',
  ai_summary: 'aiSummary',
  entity_type: 'entityType',
  entity_id: 'entityId',
  assignee_id: 'assigneeId',
}

/** Normalize AI payloads (snake_case / wrappers) into the action schema shape. */
export function normalizeAiAction(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const input = raw as Record<string, unknown>
  const out: Record<string, unknown> = { ...input }
  for (const [snake, camel] of Object.entries(snakeToCamel)) {
    if (snake in out && !(camel in out)) out[camel] = out[snake]
  }
  return out
}

export function parseAiActions(value: unknown): AiAction[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { actions?: unknown }).actions)
      ? ((value as { actions: unknown[] }).actions)
      : null
  if (!list) return []
  return list.flatMap((item) => {
    const parsed = aiActionSchema.safeParse(normalizeAiAction(item))
    return parsed.success ? [parsed.data] : []
  })
}

export function extractAiActionsFromContent(content: string): AiAction[] {
  const match = content.match(/```actions(?:\s+json)?\s*\n([\s\S]*?)```/i)
  if (!match) return []
  try {
    return parseAiActions(JSON.parse(match[1].trim()))
  } catch {
    return []
  }
}
