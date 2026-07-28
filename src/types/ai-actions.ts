import { z } from 'zod'

export const aiActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('task.complete'),
    taskId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('task.create'),
    title: z.string().min(1),
    description: z.string().optional(),
    projectId: z.string().uuid().optional(),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional(),
    status: z
      .enum(['backlog', 'todo', 'in_progress', 'waiting', 'testing', 'done', 'archived'])
      .optional(),
    dueAt: z.string().optional(),
  }),
  z.object({
    type: z.literal('task.move'),
    taskId: z.string().uuid(),
    status: z.enum([
      'backlog',
      'todo',
      'in_progress',
      'waiting',
      'testing',
      'done',
      'archived',
    ]),
  }),
  z.object({
    type: z.literal('task.update'),
    taskId: z.string().uuid(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional(),
    dueAt: z.string().nullable().optional(),
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
    projectId: z.string().uuid(),
    name: z.string().optional(),
    description: z.string().optional(),
    completionPct: z.number().min(0).max(100).optional(),
    health: z.enum(['healthy', 'warning', 'blocked', 'critical']).optional(),
  }),
  z.object({
    type: z.literal('note.create'),
    title: z.string().min(1),
    body: z.string().optional(),
    projectId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('roadmap.create'),
    projectId: z.string().uuid(),
    title: z.string().min(1),
    horizon: z.enum(['now', 'next', 'later', 'future']).optional(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('daily_log.upsert'),
    logDate: z.string().optional(),
    workedOn: z.string().optional(),
    blockers: z.string().optional(),
    hours: z.number().optional(),
    wins: z.string().optional(),
    tomorrow: z.string().optional(),
    aiSummary: z.string().optional(),
  }),
  z.object({
    type: z.literal('activity.note'),
    summary: z.string().min(1),
    entityType: z.string().optional(),
    entityId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('idea.create'),
    title: z.string().min(1),
    description: z.string().optional(),
    projectId: z.string().uuid().optional(),
    impact: z.number().min(1).max(5).optional(),
    effort: z.number().min(1).max(5).optional(),
  }),
])

export type AiAction = z.infer<typeof aiActionSchema>

export const aiActionsArraySchema = z.array(aiActionSchema)
