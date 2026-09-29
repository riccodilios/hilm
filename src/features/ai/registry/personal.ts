import { z } from 'zod'
import { registerAction } from '@/features/ai/registry'
import {
  healthEnum,
  optionalPriority,
  optionalUuid,
  requiredTaskStatus,
  requiredUuid,
  taskCreateFieldsSchema,
} from '@/features/ai/registry/schemas'
import { createNote } from '@/features/notes/api'
import { createIdea } from '@/features/ideas/api'
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from '@/features/projects/api'
import {
  createLabel,
  deleteLabel,
  listLabels,
  setProjectLabels,
  updateLabel,
} from '@/features/projects/labels-api'
import { createRoadmapItem } from '@/features/roadmap/api'
import { upsertDailyLog } from '@/features/daily-log/api'
import {
  AmbiguousTaskMatchError,
  archiveTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  resolveTaskIdForAction,
  updateTask,
} from '@/features/tasks/api'
import { recordActivity } from '@/features/activity/record'
import { requireUserId } from '@/lib/supabase/activity'
import { supabase } from '@/lib/supabase/client'
import {
  buildCreateClientKey,
  recallActionResult,
  rememberActionResult,
} from '@/features/ai/lib/action-idempotency'
import { verifyCreatedTask } from '@/features/ai/lib/action-verify'
import type { Priority, TaskStatus } from '@/types/domain'

function tomorrowIso() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

async function requireResolvedTaskId(taskId: string, currentTitleHint?: string) {
  try {
    const resolved = await resolveTaskIdForAction(taskId, currentTitleHint)
    if (!resolved) {
      throw new Error(
        'Could not identify which task to change. Name the task or create a new one explicitly.',
      )
    }
    return resolved
  } catch (error) {
    if (error instanceof AmbiguousTaskMatchError) throw error
    throw error
  }
}

async function ensurePersonalProjectId(opts?: {
  projectId?: string
  projectName?: string
}) {
  const byName = await resolvePersonalProjectId(opts)
  if (byName) return byName
  if (opts?.projectId || opts?.projectName) {
    throw new Error(
      opts.projectName
        ? `Could not find project “${opts.projectName}”. Create it first or pick an existing project.`
        : 'Could not find that project.',
    )
  }
  const projects = await listProjects()
  if (projects.length === 1) return projects[0]!.id
  if (!projects.length) throw new Error('Create your first project before adding tasks.')
  throw new Error(
    `Which project should this task go in? Available: ${projects
      .slice(0, 8)
      .map((project) => project.name)
      .join(', ')}.`,
  )
}

async function resolvePersonalProjectId(opts?: {
  projectId?: string
  projectName?: string
}) {
  if (opts?.projectId) {
    const projects = await listProjects()
    if (projects.some((project) => project.id === opts.projectId)) return opts.projectId
  }
  const name = opts?.projectName?.trim().toLowerCase()
  if (name) {
    const projects = await listProjects()
    const exact = projects.find((project) => project.name.trim().toLowerCase() === name)
    if (exact) return exact.id
    const partial = projects.find((project) =>
      project.name.trim().toLowerCase().includes(name) ||
      name.includes(project.name.trim().toLowerCase()),
    )
    if (partial) return partial.id
  }
  return null
}

export function registerPersonalActions() {
  registerAction({
    type: 'task.complete',
    os: 'personal',
    title: 'Complete task',
    description: 'Mark a task done',
    risk: 'safe',
    parallelSafe: true,
    inputSchema: z.object({
      type: z.literal('task.complete'),
      taskId: requiredUuid,
      title: z.string().optional(),
    }),
    promptFields: 'taskId, title?',
    execute: async (input) => {
      try {
        const taskId = await requireResolvedTaskId(input.taskId, input.title)
        const updated = await updateTask(taskId, { status: 'done' })
        return {
          ok: true,
          summary: `Completed “${updated.title ?? taskId}”`,
          verified: true,
          entities: [{ type: 'task', id: taskId }],
          data: updated,
          code: 'task.completed',
        }
      } catch (error) {
        if (error instanceof AmbiguousTaskMatchError) {
          return {
            ok: false,
            summary: error.message,
            ambiguous: true,
            code: error.code,
          }
        }
        return {
          ok: false,
          summary: error instanceof Error ? error.message : 'Could not complete task',
          code: 'task.complete_failed',
        }
      }
    },
  })

  registerAction({
    type: 'task.create',
    os: 'personal',
    title: 'Create task',
    description: 'Create a personal task (always INSERT — never updates an existing task)',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('task.create'),
      projectId: optionalUuid,
      projectName: z.string().min(1).optional(),
      ...taskCreateFieldsSchema.omit({ assigneeId: true, departmentId: true, teamId: true }).shape,
    }),
    promptFields:
      'title, description?, projectId?, projectName?, priority?, status? (backlog|todo|in_progress|waiting|testing|done), dueAt?, clientKey?',
    execute: async (input) => {
      const projectId = await ensurePersonalProjectId({
        projectId: input.projectId,
        projectName: input.projectName,
      })
      const userId = await requireUserId()
      const clientKey = buildCreateClientKey({
        title: input.title,
        projectId,
        explicit: input.clientKey,
      })
      const scope = `personal:${userId}`
      const cached = recallActionResult(scope, clientKey)
      if (cached?.ok && cached.entities?.[0]?.id) {
        return {
          ...cached,
          reused: true,
          code: 'task.create_idempotent',
          summary: cached.summary || `Already created “${input.title}” in this request`,
        }
      }

      const task = await createTask({
        title: input.title,
        description: input.description,
        projectId,
        priority: input.priority as Priority | undefined,
        status: input.status as TaskStatus | undefined,
        dueAt: input.dueAt,
      })
      if (!task?.id) {
        return {
          ok: false,
          summary: 'Task creation did not return an id — nothing was created.',
          code: 'task.create_no_id',
          verified: false,
        }
      }

      const verified = await verifyCreatedTask({
        os: 'personal',
        taskId: task.id,
        expected: { title: input.title, projectId, userId },
      })
      if (!verified.ok) {
        return {
          ok: false,
          summary: verified.summary,
          code: verified.code ?? 'verify_failed',
          verified: false,
          entities: [{ type: 'task', id: task.id }],
        }
      }

      const project = (await listProjects()).find((row) => row.id === projectId)
      const result = {
        ok: true as const,
        summary: `Created “${task.title}”${project ? ` in ${project.name}` : ''}`,
        verified: true,
        entities: [
          { type: 'task' as const, id: task.id },
          { type: 'project' as const, id: projectId },
        ],
        data: {
          ...task,
          project_id: projectId,
          project_name: project?.name,
          action: 'task.created',
        },
        code: 'task.created',
      }
      rememberActionResult(scope, clientKey, result)
      return result
    },
  })

  registerAction({
    type: 'task.create_many',
    os: 'personal',
    title: 'Create tasks (batch)',
    description: 'Create multiple personal tasks — each item is an independent INSERT',
    risk: 'safe',
    parallelSafe: true,
    inputSchema: z.object({
      type: z.literal('task.create_many'),
      projectId: optionalUuid,
      projectName: z.string().min(1).optional(),
      items: z.array(z.record(z.string(), z.unknown())).min(1).max(40),
    }),
    promptFields:
      'projectId?, projectName?, items:[{title, description?, priority?, status?, dueAt?, clientKey?}] (max 40)',
    execute: async (input) => {
      const projectId = await ensurePersonalProjectId({
        projectId: input.projectId,
        projectName: input.projectName,
      })
      const userId = await requireUserId()
      const project = (await listProjects()).find((row) => row.id === projectId)
      const items: Array<{
        index: number
        title: string
        ok: boolean
        summary: string
        taskId?: string
        reused?: boolean
        error?: string
      }> = []

      for (let index = 0; index < input.items.length; index++) {
        const raw = input.items[index]!
        const parsed = taskCreateFieldsSchema.safeParse(raw)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          items.push({
            index,
            title:
              typeof (raw as { title?: unknown }).title === 'string'
                ? String((raw as { title: string }).title)
                : `Item ${index + 1}`,
            ok: false,
            summary: issue?.message ?? 'Invalid item',
            error: issue?.message ?? 'Invalid item',
          })
          continue
        }
        const fields = parsed.data
        const clientKey = buildCreateClientKey({
          title: fields.title,
          projectId,
          index,
          explicit: fields.clientKey,
        })
        const scope = `personal:${userId}`
        const cached = recallActionResult(scope, clientKey)
        if (cached?.ok && cached.entities?.[0]?.id) {
          items.push({
            index,
            title: fields.title,
            ok: true,
            reused: true,
            summary: `Already created “${fields.title}” in this request`,
            taskId: cached.entities[0].id,
          })
          continue
        }
        try {
          const task = await createTask({
            title: fields.title,
            description: fields.description,
            projectId,
            priority: fields.priority as Priority | undefined,
            status: fields.status as TaskStatus | undefined,
            dueAt: fields.dueAt,
          })
          const verified = await verifyCreatedTask({
            os: 'personal',
            taskId: task.id,
            expected: { title: fields.title, projectId, userId },
          })
          if (!verified.ok) {
            items.push({
              index,
              title: fields.title,
              ok: false,
              summary: verified.summary,
              error: verified.summary,
            })
            continue
          }
          const result = {
            ok: true as const,
            summary: `Created “${task.title}”`,
            verified: true,
            entities: [{ type: 'task' as const, id: task.id }],
            data: task,
            code: 'task.created',
          }
          rememberActionResult(scope, clientKey, result)
          items.push({
            index,
            title: fields.title,
            ok: true,
            summary: result.summary,
            taskId: task.id,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          items.push({
            index,
            title: fields.title,
            ok: false,
            summary: message,
            error: message,
          })
        }
      }

      const succeeded = items.filter((row) => row.ok && !row.reused)
      const reused = items.filter((row) => row.ok && row.reused)
      const failed = items.filter((row) => !row.ok)
      const ok = succeeded.length + reused.length > 0
      return {
        ok,
        verified: failed.length === 0 && succeeded.length > 0,
        summary:
          failed.length === 0
            ? `Created ${succeeded.length} task${succeeded.length === 1 ? '' : 's'}${
                project ? ` in ${project.name}` : ''
              }`
            : `Created ${succeeded.length} of ${items.length} tasks${
                project ? ` in ${project.name}` : ''
              } (${failed.length} failed)`,
        entities: [
          ...items
            .filter((row) => row.ok && row.taskId)
            .map((row) => ({ type: 'task' as const, id: row.taskId! })),
          { type: 'project' as const, id: projectId },
        ],
        data: {
          project_id: projectId,
          project_name: project?.name,
          items,
          succeeded: succeeded.length,
          failed: failed.length,
          reused: reused.length,
          total: items.length,
          action: 'task.create_many',
        },
        code: failed.length ? 'task.create_many_partial' : 'task.create_many',
      }
    },
  })

  registerAction({
    type: 'task.move',
    os: 'personal',
    title: 'Move task',
    description: 'Change task status',
    risk: 'safe',
    parallelSafe: true,
    inputSchema: z.object({
      type: z.literal('task.move'),
      taskId: requiredUuid,
      status: requiredTaskStatus,
      title: z.string().optional(),
    }),
    promptFields: 'taskId, status, title?',
    execute: async (input) => {
      try {
        const taskId = await requireResolvedTaskId(input.taskId, input.title)
        await moveTask(taskId, input.status as TaskStatus)
        const updated = await getTask(taskId)
        return {
          ok: true,
          summary: `Moved “${updated.title ?? taskId}” to ${input.status}`,
          verified: true,
          entities: [{ type: 'task', id: taskId }],
          data: updated,
          code: 'task.moved',
        }
      } catch (error) {
        if (error instanceof AmbiguousTaskMatchError) {
          return { ok: false, summary: error.message, ambiguous: true, code: error.code }
        }
        return {
          ok: false,
          summary: error instanceof Error ? error.message : 'Could not move task',
          code: 'task.move_failed',
        }
      }
    },
  })

  registerAction({
    type: 'task.update',
    os: 'personal',
    title: 'Update task',
    description: 'Update task fields or move the task to another project — requires an identifiable taskId',
    risk: 'safe',
    parallelSafe: true,
    inputSchema: z.object({
      type: z.literal('task.update'),
      taskId: requiredUuid,
      title: z.string().optional(),
      description: z.string().optional(),
      priority: optionalPriority,
      dueAt: z.string().nullable().optional(),
      projectId: optionalUuid,
      projectName: z.string().min(1).optional(),
    }),
    promptFields:
      'taskId, title?, description?, priority?, dueAt?, projectId?, projectName? (to move the task to another project)',
    execute: async (input) => {
      // Do NOT look up by input.title — that field is the NEW title when renaming.
      // Never create a new task from an update request. Never fall back to "any open task".
      let taskId: string
      try {
        const resolved = await resolveTaskIdForAction(input.taskId)
        if (!resolved) {
          return {
            ok: false,
            summary:
              'Could not find the task to update. Name which task to change, or create a new one explicitly.',
            code: 'task.update_missing',
          }
        }
        taskId = resolved
      } catch (error) {
        if (error instanceof AmbiguousTaskMatchError) {
          return { ok: false, summary: error.message, ambiguous: true, code: error.code }
        }
        throw error
      }

      let projectId: string | undefined
      if (input.projectId || input.projectName) {
        const resolved = await resolvePersonalProjectId({
          projectId: input.projectId,
          projectName: input.projectName,
        })
        if (!resolved) {
          return {
            ok: false,
            summary: input.projectName
              ? `Could not find project “${input.projectName}”.`
              : 'Could not find that project.',
            code: 'project_missing',
          }
        }
        projectId = resolved
      }

      const updated = await updateTask(taskId, {
        title: input.title,
        description: input.description,
        priority: input.priority as Priority | undefined,
        due_at: input.dueAt,
        ...(input.dueAt !== undefined
          ? { due_date: input.dueAt ? input.dueAt.slice(0, 10) : null }
          : {}),
        ...(projectId ? { project_id: projectId } : {}),
      })
      return {
        ok: true,
        verified: true,
        summary: projectId
          ? `Moved “${updated.title ?? taskId}” to ${updated.projects?.name ?? 'another project'}`
          : `Updated “${updated.title ?? taskId}”`,
        entities: [
          { type: 'task', id: taskId },
          ...(projectId ? [{ type: 'project' as const, id: projectId }] : []),
        ],
        data: { ...updated, action: 'task.updated' },
        code: 'task.updated',
      }
    },
  })

  registerAction({
    type: 'task.delete',
    os: 'personal',
    title: 'Delete task',
    description: 'Permanently delete a task',
    risk: 'destructive',
    inputSchema: z.object({
      type: z.literal('task.delete'),
      taskId: requiredUuid,
      title: z.string().optional(),
    }),
    promptFields: 'taskId, title?',
    execute: async (input) => {
      try {
        const taskId = await resolveTaskIdForAction(input.taskId, input.title)
        if (!taskId) {
          return {
            ok: false,
            summary: 'Could not find that task to delete.',
            code: 'task.delete_missing',
          }
        }
        await deleteTask(taskId)
        return {
          ok: true,
          verified: true,
          summary: `Deleted task ${taskId}`,
          entities: [{ type: 'task', id: taskId }],
          code: 'task.deleted',
        }
      } catch (error) {
        if (error instanceof AmbiguousTaskMatchError) {
          return { ok: false, summary: error.message, ambiguous: true, code: error.code }
        }
        throw error
      }
    },
  })

  registerAction({
    type: 'task.archive',
    os: 'personal',
    title: 'Archive task',
    description: 'Archive a task',
    risk: 'confirm',
    inputSchema: z.object({
      type: z.literal('task.archive'),
      taskId: requiredUuid,
      title: z.string().optional(),
    }),
    promptFields: 'taskId, title?',
    execute: async (input) => {
      try {
        const taskId = await resolveTaskIdForAction(input.taskId, input.title)
        if (!taskId) {
          return {
            ok: false,
            summary: 'Could not find that task to archive.',
            code: 'task.archive_missing',
          }
        }
        await archiveTask(taskId)
        return {
          ok: true,
          verified: true,
          summary: `Archived task ${taskId}`,
          entities: [{ type: 'task', id: taskId }],
          code: 'task.archived',
        }
      } catch (error) {
        if (error instanceof AmbiguousTaskMatchError) {
          return { ok: false, summary: error.message, ambiguous: true, code: error.code }
        }
        throw error
      }
    },
  })

  registerAction({
    type: 'task.schedule',
    os: 'personal',
    title: 'Schedule task',
    description: 'Set or clear a task due date',
    risk: 'safe',
    parallelSafe: true,
    inputSchema: z.object({
      type: z.literal('task.schedule'),
      taskId: requiredUuid,
      dueAt: z.string().nullable(),
      title: z.string().optional(),
    }),
    promptFields: 'taskId, dueAt, title?',
    execute: async (input) => {
      try {
        const taskId = await requireResolvedTaskId(input.taskId, input.title)
        const dueAt = input.dueAt
        const updated = await updateTask(taskId, {
          due_at: dueAt,
          due_date: dueAt ? dueAt.slice(0, 10) : null,
        })
        return {
          ok: true,
          verified: true,
          summary: dueAt ? `Scheduled “${updated.title ?? taskId}”` : `Cleared schedule`,
          entities: [{ type: 'task', id: taskId }],
          data: updated,
          code: 'task.scheduled',
        }
      } catch (error) {
        if (error instanceof AmbiguousTaskMatchError) {
          return { ok: false, summary: error.message, ambiguous: true, code: error.code }
        }
        return {
          ok: false,
          summary: error instanceof Error ? error.message : 'Could not schedule task',
          code: 'task.schedule_failed',
        }
      }
    },
  })

  registerAction({
    type: 'task.move_overdue',
    os: 'personal',
    title: 'Reschedule overdue',
    description: 'Move all overdue incomplete tasks to tomorrow',
    risk: 'confirm',
    inputSchema: z.object({ type: z.literal('task.move_overdue') }),
    promptFields: '(none)',
    execute: async () => {
      const tasks = await listTasks()
      const now = Date.now()
      const due = tomorrowIso()
      let count = 0
      for (const task of tasks) {
        if (task.status === 'done' || task.status === 'archived') continue
        if (!task.due_at) continue
        if (new Date(task.due_at).getTime() >= now) continue
        await updateTask(task.id, { due_at: due })
        count += 1
      }
      return { ok: true, summary: `Rescheduled ${count} overdue tasks to tomorrow` }
    },
  })

  registerAction({
    type: 'subtask.create',
    os: 'personal',
    title: 'Create subtask',
    description: 'Add a subtask under a task',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('subtask.create'),
      taskId: requiredUuid,
      title: z.string().min(1),
    }),
    promptFields: 'taskId, title',
    execute: async (input) => {
      const userId = await requireUserId()
      const { data: existing } = await supabase
        .from('subtasks')
        .select('position')
        .eq('task_id', input.taskId)
        .order('position', { ascending: false })
        .limit(1)
      const position = (existing?.[0]?.position ?? -1) + 1
      const { data, error } = await supabase
        .from('subtasks')
        .insert({
          user_id: userId,
          task_id: input.taskId,
          title: input.title,
          position,
        })
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data?.id) throw new Error('Could not create subtask — check the task id')
      return {
        ok: true,
        summary: `Created subtask ${input.title}`,
        entities: [{ type: 'subtask', id: data.id }],
      }
    },
  })

  registerAction({
    type: 'subtask.complete',
    os: 'personal',
    title: 'Complete subtask',
    description: 'Mark a subtask done',
    risk: 'safe',
    parallelSafe: true,
    inputSchema: z.object({
      type: z.literal('subtask.complete'),
      subtaskId: requiredUuid,
      done: z.boolean().optional(),
    }),
    promptFields: 'subtaskId, done?',
    execute: async (input) => {
      const { error } = await supabase
        .from('subtasks')
        .update({ done: input.done ?? true })
        .eq('id', input.subtaskId)
      if (error) throw error
      return { ok: true, summary: `Updated subtask ${input.subtaskId}` }
    },
  })

  registerAction({
    type: 'project.create',
    os: 'personal',
    title: 'Create project',
    description: 'Create a personal project',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('project.create'),
      name: z.string().min(1),
      description: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
    }),
    promptFields: 'name, description?, color?, icon?',
    execute: async (input) => {
      const name = input.name.trim()
      const projects = await listProjects()
      const existing = projects.find(
        (project) => project.name.trim().toLowerCase() === name.toLowerCase(),
      )
      if (existing) {
        return {
          ok: true,
          summary: `Using existing project “${existing.name}”`,
          entities: [{ type: 'project', id: existing.id }],
          data: { ...existing, reused: true },
        }
      }
      const project = await createProject({ ...input, name })
      return {
        ok: true,
        summary: `Created project ${name}`,
        entities: [{ type: 'project', id: project.id }],
        data: project,
      }
    },
  })

  registerAction({
    type: 'project.update',
    os: 'personal',
    title: 'Update project',
    description: 'Update project fields',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('project.update'),
      projectId: requiredUuid,
      name: z.string().optional(),
      description: z.string().optional(),
      completionPct: z.coerce.number().min(0).max(100).optional(),
      health: healthEnum.optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
    }),
    promptFields: 'projectId, name?, description?, completionPct?, health?, color?, icon?, status?',
    execute: async (input) => {
      await updateProject(input.projectId, {
        name: input.name,
        description: input.description,
        completion_pct: input.completionPct,
        health: input.health,
        color: input.color,
        icon: input.icon,
        status: input.status,
      })
      return { ok: true, summary: `Updated project ${input.projectId}` }
    },
  })

  registerAction({
    type: 'project.delete',
    os: 'personal',
    title: 'Delete project',
    description: 'Delete a personal project',
    risk: 'destructive',
    inputSchema: z.object({ type: z.literal('project.delete'), projectId: requiredUuid }),
    promptFields: 'projectId',
    execute: async (input) => {
      await deleteProject(input.projectId)
      return { ok: true, summary: `Deleted project ${input.projectId}` }
    },
  })

  registerAction({
    type: 'project.archive',
    os: 'personal',
    title: 'Archive project',
    description: 'Archive a personal project',
    risk: 'confirm',
    inputSchema: z.object({ type: z.literal('project.archive'), projectId: requiredUuid }),
    promptFields: 'projectId',
    execute: async (input) => {
      await updateProject(input.projectId, { status: 'archived' })
      return { ok: true, summary: `Archived project ${input.projectId}` }
    },
  })

  registerAction({
    type: 'label.create',
    os: 'personal',
    title: 'Create label',
    description: 'Create a personal project label',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('label.create'),
      name: z.string().min(1),
      color: z.string().optional(),
    }),
    promptFields: 'name, color?',
    execute: async (input) => {
      const label = await createLabel(input)
      return {
        ok: true,
        summary: `Created label ${input.name}`,
        entities: [{ type: 'label', id: label.id }],
      }
    },
  })

  registerAction({
    type: 'label.update',
    os: 'personal',
    title: 'Update label',
    description: 'Rename or recolor a label',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('label.update'),
      labelId: requiredUuid,
      name: z.string().optional(),
      color: z.string().optional(),
    }),
    promptFields: 'labelId, name?, color?',
    execute: async (input) => {
      await updateLabel(input.labelId, { name: input.name, color: input.color })
      return { ok: true, summary: `Updated label ${input.labelId}` }
    },
  })

  registerAction({
    type: 'label.delete',
    os: 'personal',
    title: 'Delete label',
    description: 'Delete a label and remove it from all projects',
    risk: 'destructive',
    inputSchema: z.object({ type: z.literal('label.delete'), labelId: requiredUuid }),
    promptFields: 'labelId',
    execute: async (input) => {
      await deleteLabel(input.labelId)
      return { ok: true, summary: `Deleted label ${input.labelId}` }
    },
  })

  registerAction({
    type: 'label.assign',
    os: 'personal',
    title: 'Assign labels',
    description: 'Replace labels on a project',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('label.assign'),
      projectId: requiredUuid,
      labelIds: z.array(requiredUuid),
    }),
    promptFields: 'projectId, labelIds[]',
    execute: async (input) => {
      await setProjectLabels(input.projectId, input.labelIds)
      return { ok: true, summary: `Set labels on project ${input.projectId}` }
    },
  })

  registerAction({
    type: 'label.apply_named',
    os: 'personal',
    title: 'Apply named label',
    description: 'Find a label by name and add it to a project (keeps existing)',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('label.apply_named'),
      projectId: requiredUuid,
      name: z.string().min(1),
      color: z.string().optional(),
    }),
    promptFields: 'projectId, name, color?',
    execute: async (input) => {
      const labels = await listLabels()
      let label = labels.find((l) => l.name.toLowerCase() === input.name.toLowerCase())
      if (!label) label = await createLabel({ name: input.name, color: input.color })
      const { listProjectLabels } = await import('@/features/projects/labels-api')
      const current = await listProjectLabels(input.projectId)
      const ids = Array.from(new Set([...current.map((l) => l.id), label.id]))
      await setProjectLabels(input.projectId, ids)
      return { ok: true, summary: `Applied label ${label.name} to project` }
    },
  })

  registerAction({
    type: 'label.remove_named',
    os: 'personal',
    title: 'Remove named label',
    description: 'Remove a label from a project by name without deleting the label',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('label.remove_named'),
      projectId: requiredUuid,
      name: z.string().min(1),
    }),
    promptFields: 'projectId, name',
    execute: async (input) => {
      const labels = await listLabels()
      const label = labels.find((l) => l.name.toLowerCase() === input.name.toLowerCase())
      if (!label) return { ok: true, summary: `Label ${input.name} not found — nothing to remove` }
      const { listProjectLabels } = await import('@/features/projects/labels-api')
      const current = await listProjectLabels(input.projectId)
      await setProjectLabels(
        input.projectId,
        current.filter((l) => l.id !== label.id).map((l) => l.id),
      )
      return { ok: true, summary: `Removed label ${label.name} from project` }
    },
  })

  registerAction({
    type: 'note.create',
    os: 'personal',
    title: 'Create note',
    description: 'Create a personal note',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('note.create'),
      title: z.string().min(1),
      body: z.string().optional(),
      projectId: optionalUuid,
    }),
    promptFields: 'title, body?, projectId?',
    execute: async (input) => {
      const note = await createNote(input)
      return { ok: true, summary: `Created note ${input.title}`, data: note }
    },
  })

  registerAction({
    type: 'roadmap.create',
    os: 'personal',
    title: 'Create roadmap item',
    description: 'Add a roadmap item to a project',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('roadmap.create'),
      projectId: requiredUuid,
      title: z.string().min(1),
      horizon: z.enum(['now', 'next', 'later', 'future']).optional(),
      description: z.string().optional(),
    }),
    promptFields: 'projectId, title, horizon?, description?',
    execute: async (input) => {
      const item = await createRoadmapItem(input)
      return { ok: true, summary: `Created roadmap item ${input.title}`, data: item }
    },
  })

  registerAction({
    type: 'daily_log.upsert',
    os: 'personal',
    title: 'Upsert daily log',
    description: 'Write or update today\'s daily log',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('daily_log.upsert'),
      logDate: z.string().optional(),
      workedOn: z.string().optional(),
      blockers: z.string().optional(),
      hours: z.coerce.number().optional(),
      wins: z.string().optional(),
      tomorrow: z.string().optional(),
      aiSummary: z.string().optional(),
    }),
    promptFields: 'logDate?, workedOn?, blockers?, hours?, wins?, tomorrow?, aiSummary?',
    execute: async (input) => {
      await upsertDailyLog(input)
      return { ok: true, summary: 'Updated daily log' }
    },
  })

  registerAction({
    type: 'activity.note',
    os: 'personal',
    title: 'Activity note',
    description: 'Record an activity note',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('activity.note'),
      summary: z.string().min(1),
      entityType: z.string().optional(),
      entityId: optionalUuid,
      projectId: optionalUuid,
    }),
    promptFields: 'summary, entityType?, entityId?, projectId?',
    execute: async (input) => {
      const userId = await requireUserId()
      await recordActivity({
        userId,
        entityType: input.entityType ?? 'ai_note',
        entityId: input.entityId,
        projectId: input.projectId,
        action: 'noted',
        summary: input.summary,
      })
      return { ok: true, summary: 'Recorded activity note' }
    },
  })

  registerAction({
    type: 'idea.create',
    os: 'personal',
    title: 'Create idea',
    description: 'Capture an idea',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('idea.create'),
      title: z.string().min(1),
      description: z.string().optional(),
      projectId: optionalUuid,
      impact: z.coerce.number().min(1).max(5).optional(),
      effort: z.coerce.number().min(1).max(5).optional(),
    }),
    promptFields: 'title, description?, projectId?, impact?, effort?',
    execute: async (input) => {
      const idea = await createIdea(input)
      return { ok: true, summary: `Created idea ${input.title}`, data: idea }
    },
  })

  registerAction({
    type: 'report.generate',
    os: 'personal',
    title: 'Generate report',
    description:
      'Generate a branded Personal OS report with metrics/charts from live Hilm data and store it in report history',
    risk: 'safe',
    inputSchema: z.object({
      type: z.literal('report.generate'),
      title: z.string().min(1),
      body: z.string().min(1),
      projectId: optionalUuid,
      projectName: z.string().min(1).optional(),
      datePreset: z
        .enum(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'])
        .optional(),
      metrics: z.array(z.string()).max(20).optional(),
      charts: z
        .array(
          z.object({
            id: z.enum([
              'tasks_by_status',
              'tasks_by_priority',
              'effort_by_project',
              'open_by_member',
              'completion_trend',
              'project_comparison',
            ]),
            kind: z.enum(['bar', 'column', 'pie', 'line', 'comparison']),
          }),
        )
        .max(8)
        .optional(),
    }),
    promptFields:
      'title, body (describe desired metrics/charts/fields in natural language), projectId?, projectName?, datePreset?, metrics?, charts:[{id:tasks_by_status|tasks_by_priority|effort_by_project|open_by_member|completion_trend|project_comparison, kind:bar|column|pie|line|comparison}]?',
    execute: async (input) => {
      const userId = await requireUserId()
      const [{ data: profile }, projects, tasks] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
        listProjects(),
        listTasks(),
      ])
      const generatedBy = profile?.display_name?.trim() || 'Hilm user'
      const { customizeReportFromPrompt } = await import('@/features/reports/engine/aiCustomize')
      const { buildReportSnapshot } = await import('@/features/reports/engine/buildSnapshot')
      const { savePersonalReport } = await import('@/features/reports/api')
      let projectIds: string[] | 'all' = input.projectId ? [input.projectId] : 'all'
      if (!input.projectId && input.projectName?.trim()) {
        const needle = input.projectName.trim().toLowerCase()
        const match = projects.find((project) => project.name.trim().toLowerCase() === needle)
        if (match) projectIds = [match.id]
      }
      const customized = customizeReportFromPrompt('personal', `${input.title}. ${input.body}`, {
        title: input.title,
        projectIds,
        datePreset: input.datePreset ?? 'this_week',
        metrics: (input.metrics ?? []) as never[],
        charts: input.charts,
      })
      const snapshot = buildReportSnapshot({
        os: 'personal',
        config: customized.config,
        generatedBy,
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          health: project.health,
          completion_pct: project.completion_pct,
          status: project.status,
        })),
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          project_id: task.project_id,
          due_date: task.due_date,
          due_at: task.due_at,
          completed_at: task.completed_at,
          created_at: task.created_at,
          estimated_hours: task.estimated_hours,
        })),
        aiPromptNotes: customized.notes,
      })
      const saved = await savePersonalReport(snapshot)
      return {
        ok: true,
        summary: `Generated report ${snapshot.title}`,
        data: { reportId: saved.id, title: snapshot.title },
      }
    },
  })

  registerAction({
    type: 'mission.schedule_day',
    os: 'personal',
    title: 'Schedule day',
    description: 'Propose due times for open tasks today (sets dueAt)',
    risk: 'confirm',
    inputSchema: z.object({
      type: z.literal('mission.schedule_day'),
      assignments: z.array(
        z.object({
          taskId: requiredUuid,
          dueAt: z.string(),
        }),
      ),
    }),
    promptFields: 'assignments[{taskId, dueAt}]',
    execute: async (input) => {
      for (const row of input.assignments) {
        const dueAt = row.dueAt
        await updateTask(row.taskId, {
          due_at: dueAt,
          due_date: dueAt ? dueAt.slice(0, 10) : null,
        })
      }
      return {
        ok: true,
        summary: `Scheduled ${input.assignments.length} tasks for the day`,
      }
    },
  })
}
