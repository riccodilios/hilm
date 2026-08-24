import { z } from 'zod'
import { registerAction } from '@/features/ai/registry'
import {
  healthEnum,
  optionalPriority,
  optionalUuid,
  requiredTaskStatus,
  requiredUuid,
  taskCreateFieldsSchema,
  taskIdOrRef,
} from '@/features/ai/registry/schemas'
import {
  canEditContent,
  canManageMembers,
  canManageWorkspace,
} from '@/features/workspace-os/lib/permissions'
import {
  createWorkspaceProject,
  createWorkspaceTask,
  deleteWorkspaceProject,
  deleteWorkspaceTask,
  getWorkspace,
  listWorkspaceMembers,
  listWorkspaceProjects,
  listWorkspaceTasks,
  recordWorkspaceActivityNote,
  updateWorkspaceProject,
  updateWorkspaceTask,
} from '@/features/workspace-os/api'
import { createWorkspaceTaskComment } from '@/features/workspace-os/comments-api'
import {
  createWorkspaceLabel,
  deleteWorkspaceLabel,
  listProjectLabels,
  listWorkspaceLabels,
  setProjectLabels,
  updateWorkspaceLabel,
} from '@/features/workspace-os/labels-api'
import {
  createDepartment,
  createTeam,
  deleteDepartment,
  updateDepartment,
  updateTeam,
} from '@/features/workspace-os/org-api'
import { analyzeAssignmentCandidates } from '@/features/workspace-os/load-balancer'
import {
  mapPool,
  WORKSPACE_BATCH_DEFAULT_CONCURRENCY,
  WORKSPACE_BATCH_MAX_ITEMS,
  type BatchItemResult,
} from '@/features/ai/lib/batch-engine'
import { resolveWorkspaceProjectForAction } from '@/features/ai/lib/resolve-workspace-project'
import { resolveWorkspaceTaskForAction } from '@/features/workspace-os/lib/resolve-workspace-task'
import { formatWorkspaceTaskRef } from '@/features/workspace-os/lib/task-refs'
import { requireUserId } from '@/lib/supabase/activity'
import { supabase } from '@/lib/supabase/client'
import type { Priority, TaskStatus } from '@/types/domain'

async function resolveTaskOrFail(
  workspaceId: string,
  taskId: string,
  preferTaskId?: string | null,
) {
  const resolved = await resolveWorkspaceTaskForAction(workspaceId, {
    taskId,
    taskRef: taskId,
    preferTaskId,
  })
  return resolved
}

export function registerWorkspaceActions() {
  const editOk = (ctx: { role?: string | null }) => canEditContent(ctx.role as never)
  const manageOk = (ctx: { role?: string | null }) => canManageWorkspace(ctx.role as never)
  const membersOk = (ctx: { role?: string | null }) => canManageMembers(ctx.role as never)

  registerAction({
    type: 'task.complete',
    os: 'workspace',
    title: 'Complete task',
    description: 'Mark a workspace task done',
    risk: 'safe',
    parallelSafe: true,
    permission: editOk,
    inputSchema: z.object({ type: z.literal('task.complete'), taskId: taskIdOrRef }),
    promptFields: 'taskId (UUID, KEY-N, or exact title)',
    execute: async (input, ctx) => {
      const resolved = await resolveTaskOrFail(
        ctx.workspaceId!,
        input.taskId,
        ctx.conversationFocus?.lastModifiedTaskId,
      )
      if (!resolved.ok) return { ok: false, summary: resolved.reason }
      await updateWorkspaceTask(ctx.workspaceId!, resolved.task.id, { status: 'done' })
      const ws = await getWorkspace(ctx.workspaceId!)
      const ref =
        formatWorkspaceTaskRef(ws.task_key, resolved.task.task_number) ?? resolved.task.id
      return { ok: true, summary: `Completed ${ref}`, entities: [{ type: 'task', id: resolved.task.id }] }
    },
  })

  registerAction({
    type: 'task.create',
    os: 'workspace',
    title: 'Create task',
    description: 'Create a workspace task under a real workspace project',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('task.create'),
      projectId: optionalUuid,
      projectName: z.string().min(1).optional(),
      ...taskCreateFieldsSchema.shape,
    }),
    promptFields:
      'title, description?, projectId?, projectName?, priority?, status? (backlog|todo|in_progress|waiting|testing|done), dueAt?, assigneeId?, departmentId?, teamId?',
    execute: async (input, ctx) => {
      const workspaceId = ctx.workspaceId!
      const workspace = await getWorkspace(workspaceId)
      const resolved = await resolveWorkspaceProjectForAction(workspaceId, {
        projectId: input.projectId,
        projectName: input.projectName,
        preferProjectId: ctx.conversationFocus?.lastReferencedProjectId,
        workspaceName: workspace.name,
      })
      if (!resolved.ok) {
        const hint = resolved.candidates?.length
          ? ` Available projects: ${resolved.candidates.map((row) => row.name).join(', ')}.`
          : ''
        return { ok: false, summary: `${resolved.reason}${hint}` }
      }

      let project = resolved.project
      const existingOpen = (await listWorkspaceTasks(workspaceId)).find(
        (task) =>
          task.project_id === project.id &&
          task.status !== 'done' &&
          task.status !== 'archived' &&
          task.title.trim().toLowerCase() === input.title.trim().toLowerCase(),
      )
      if (existingOpen) {
        const taskRef = formatWorkspaceTaskRef(workspace.task_key, existingOpen.task_number)
        return {
          ok: true,
          summary: taskRef
            ? `Already have ${taskRef} “${existingOpen.title}” in ${project.name}`
            : `Already have “${existingOpen.title}” in ${project.name}`,
          entities: [
            { type: 'task', id: existingOpen.id },
            { type: 'project', id: project.id },
          ],
          data: {
            ...existingOpen,
            id: existingOpen.id,
            title: existingOpen.title,
            project_id: project.id,
            project_name: project.name,
            workspace_id: workspaceId,
            task_ref: taskRef,
            reused: true,
          },
        }
      }

      const dueAt = input.dueAt?.trim() || null
      const payload = {
        projectId: project.id,
        title: input.title,
        description: input.description,
        priority: input.priority as Priority | undefined,
        status: input.status as TaskStatus | undefined,
        dueDate: dueAt ? dueAt.slice(0, 10) : null,
        dueAt,
        assigneeId: input.assigneeId ?? null,
        departmentId: input.departmentId ?? null,
        teamId: input.teamId ?? null,
      }

      let task
      try {
        task = await createWorkspaceTask(workspaceId, payload)
      } catch (error) {
        // Never retry the same invalid project_id. Re-resolve once, then fail clearly.
        const message = error instanceof Error ? error.message : String(error)
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : ''
        const isFk =
          code === '23503' ||
          /workspace_tasks_project_id_fkey|is not present in table ["']workspace_projects["']/i.test(
            message,
          )
        if (!isFk) throw error

        const retry = await resolveWorkspaceProjectForAction(workspaceId, {
          projectId: null,
          projectName: input.projectName ?? project.name,
          preferProjectId: ctx.conversationFocus?.lastReferencedProjectId,
          workspaceName: workspace.name,
        })
        if (!retry.ok || retry.project.id === project.id) {
          return {
            ok: false,
            summary:
              'I couldn’t create the task because I couldn’t find that project in this workspace. Would you like me to create the project first?',
          }
        }
        project = retry.project
        task = await createWorkspaceTask(workspaceId, {
          ...payload,
          projectId: project.id,
        })
      }

      const taskRef = formatWorkspaceTaskRef(workspace.task_key, task.task_number)
      return {
        ok: true,
        summary: taskRef
          ? `Created ${taskRef} “${input.title}” in ${project.name}`
          : `Created task “${input.title}” in ${project.name}`,
        entities: [
          { type: 'task', id: task.id },
          { type: 'project', id: project.id },
        ],
        data: {
          ...task,
          id: task.id,
          title: task.title ?? input.title,
          project_id: project.id,
          project_name: project.name,
          workspace_id: workspaceId,
          due_at: task.due_at ?? dueAt,
          status: task.status ?? input.status ?? 'todo',
          task_number: task.task_number,
          task_ref: taskRef,
        },
      }
    },
  })

  registerAction({
    type: 'task.create_many',
    os: 'workspace',
    title: 'Create tasks (batch)',
    description: 'Create many workspace tasks under one project in a recoverable batch',
    risk: 'safe',
    parallelSafe: true,
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('task.create_many'),
      projectId: optionalUuid,
      projectName: z.string().min(1).optional(),
      // Gate only: require a non-empty list. Each item is validated individually in execute
      // so one bad status cannot reject the entire batch.
      items: z.array(z.record(z.string(), z.unknown())).min(1).max(WORKSPACE_BATCH_MAX_ITEMS),
    }),
    promptFields:
      'projectId?, projectName?, items:[{title, description?, priority?, status? (backlog|todo|in_progress|waiting|testing|done), dueAt?, assigneeId?, departmentId?, teamId?}] (max 40)',
    execute: async (input, ctx) => {
      const workspaceId = ctx.workspaceId!
      const workspace = await getWorkspace(workspaceId)
      const resolved = await resolveWorkspaceProjectForAction(workspaceId, {
        projectId: input.projectId,
        projectName: input.projectName,
        preferProjectId: ctx.conversationFocus?.lastReferencedProjectId,
        workspaceName: workspace.name,
      })
      if (!resolved.ok) {
        const hint = resolved.candidates?.length
          ? ` Available projects: ${resolved.candidates.map((row) => row.name).join(', ')}.`
          : ''
        return { ok: false, summary: `${resolved.reason}${hint}` }
      }

      const project = resolved.project
      const existingByTitle = new Map(
        (await listWorkspaceTasks(workspaceId))
          .filter(
            (task) =>
              task.project_id === project.id &&
              task.status !== 'done' &&
              task.status !== 'archived',
          )
          .map((task) => [task.title.trim().toLowerCase(), task]),
      )
      const seen = new Set<string>()

      type PreparedItem = {
        index: number
        fields: z.infer<typeof taskCreateFieldsSchema>
        clientKey: string
      }
      const prepared: PreparedItem[] = []
      const preFailures: BatchItemResult[] = []
      const reused: BatchItemResult[] = []

      input.items.forEach((raw, index) => {
        const parsed = taskCreateFieldsSchema.safeParse(raw)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          const path = issue?.path?.join('.') || 'item'
          preFailures.push({
            index,
            title:
              raw && typeof raw === 'object' && typeof (raw as { title?: unknown }).title === 'string'
                ? String((raw as { title: string }).title)
                : `Item ${index + 1}`,
            ok: false,
            summary: `${path}: ${issue?.message ?? 'Invalid item'}`,
            error: `${path}: ${issue?.message ?? 'Invalid item'}`,
          })
          return
        }
        const key = (parsed.data.clientKey || parsed.data.title).trim().toLowerCase()
        if (!key || seen.has(key)) {
          preFailures.push({
            index,
            title: parsed.data.title,
            ok: false,
            summary: 'Duplicate title in batch — skipped',
            error: 'Duplicate title in batch — skipped',
          })
          return
        }
        seen.add(key)
        const existing = existingByTitle.get(parsed.data.title.trim().toLowerCase())
        if (existing) {
          const taskRef = formatWorkspaceTaskRef(workspace.task_key, existing.task_number)
          reused.push({
            index,
            title: parsed.data.title,
            ok: true,
            summary: taskRef ? `Already have ${taskRef}` : `Already have “${parsed.data.title}”`,
            taskId: existing.id,
            taskRef: taskRef ?? undefined,
          })
          return
        }
        prepared.push({ index, fields: parsed.data, clientKey: key })
      })

      const createResults = await mapPool(
        prepared,
        WORKSPACE_BATCH_DEFAULT_CONCURRENCY,
        async (item): Promise<BatchItemResult> => {
          const dueAt = item.fields.dueAt?.trim() || null
          try {
            const task = await createWorkspaceTask(workspaceId, {
              projectId: project.id,
              title: item.fields.title,
              description: item.fields.description,
              priority: item.fields.priority as Priority | undefined,
              status: item.fields.status as TaskStatus | undefined,
              dueDate: dueAt ? dueAt.slice(0, 10) : null,
              dueAt,
              assigneeId: item.fields.assigneeId ?? null,
              departmentId: item.fields.departmentId ?? null,
              teamId: item.fields.teamId ?? null,
              quiet: true,
              taskKey: workspace.task_key,
            })
            const taskRef = formatWorkspaceTaskRef(workspace.task_key, task.task_number)
            return {
              index: item.index,
              title: item.fields.title,
              ok: true,
              summary: taskRef ? `Created ${taskRef}` : `Created “${item.fields.title}”`,
              taskId: task.id,
              taskRef: taskRef ?? undefined,
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
              index: item.index,
              title: item.fields.title,
              ok: false,
              summary: message,
              error: message,
            }
          }
        },
      )

      const results = [...preFailures, ...reused, ...createResults].sort((a, b) => a.index - b.index)
      const succeeded = results.filter((row) => row.ok)
      const failed = results.filter((row) => !row.ok)
      const createdCount = createResults.filter((row) => row.ok).length
      const reusedCount = reused.length
      const ok = succeeded.length > 0
      const summary =
        failed.length === 0
          ? reusedCount && createdCount
            ? `Created ${createdCount} and reused ${reusedCount} task${succeeded.length === 1 ? '' : 's'} in ${project.name}`
            : reusedCount
              ? `Already had ${reusedCount} task${reusedCount === 1 ? '' : 's'} in ${project.name}`
              : `Created ${succeeded.length} task${succeeded.length === 1 ? '' : 's'} in ${project.name}`
          : `Created ${createdCount}/${results.length} tasks in ${project.name} (${failed.length} failed)`

      return {
        ok,
        summary,
        entities: [
          ...succeeded.map((row) => ({ type: 'task', id: row.taskId! })),
          { type: 'project', id: project.id },
        ],
        data: {
          project_id: project.id,
          project_name: project.name,
          workspace_id: workspaceId,
          items: results,
          succeeded: succeeded.length,
          failed: failed.length,
          total: results.length,
          reused: reusedCount,
        },
      }
    },
  })

  registerAction({
    type: 'comment.create',
    os: 'workspace',
    title: 'Add task comment',
    description: 'Add a comment on a workspace task; supports @mentions by member name',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('comment.create'),
      taskId: taskIdOrRef,
      content: z.string().min(1),
      mentionNames: z.array(z.string().min(1)).optional(),
    }),
    promptFields: 'taskId (UUID or KEY-N), content, mentionNames?',
    execute: async (input, ctx) => {
      const workspaceId = ctx.workspaceId!
      const resolved = await resolveTaskOrFail(
        workspaceId,
        input.taskId,
        ctx.conversationFocus?.lastModifiedTaskId,
      )
      if (!resolved.ok) return { ok: false, summary: resolved.reason }

      let content = input.content.trim()
      const members = await listWorkspaceMembers(workspaceId)
      for (const name of input.mentionNames ?? []) {
        const needle = name.trim().toLowerCase()
        if (!needle) continue
        const member = members.find((row) => {
          const label = (
            row.display_name_override ||
            row.profiles?.display_name ||
            row.email ||
            ''
          ).toLowerCase()
          return label === needle || label.includes(needle) || needle.includes(label)
        })
        if (!member) continue
        const label =
          member.display_name_override ||
          member.profiles?.display_name ||
          member.email ||
          'member'
        const token = `@{${member.user_id}}`
        if (!content.includes(token)) {
          // Prefer replacing @Name if present; otherwise append.
          const atName = new RegExp(`@${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
          if (atName.test(content)) content = content.replace(atName, token)
          else content = `${content} ${token}`.trim()
        }
      }

      // Also convert leftover @DisplayName mentions from content
      const sorted = [...members].sort((a, b) => {
        const la = a.display_name_override || a.profiles?.display_name || a.email || ''
        const lb = b.display_name_override || b.profiles?.display_name || b.email || ''
        return lb.length - la.length
      })
      for (const member of sorted) {
        const label =
          member.display_name_override ||
          member.profiles?.display_name ||
          member.email ||
          ''
        if (!label) continue
        const re = new RegExp(`@${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|\\s|[.,!?;:])`, 'g')
        content = content.replace(re, `@{${member.user_id}}`)
      }

      const comment = await createWorkspaceTaskComment(workspaceId, resolved.task.id, content)
      const ws = await getWorkspace(workspaceId)
      const ref =
        formatWorkspaceTaskRef(ws.task_key, resolved.task.task_number) ?? resolved.task.id
      return {
        ok: true,
        summary: `Added your comment to ${ref}`,
        entities: [
          { type: 'task', id: resolved.task.id },
          { type: 'comment', id: comment.id },
        ],
        data: {
          comment_id: comment.id,
          task_id: resolved.task.id,
          task_ref: ref,
        },
      }
    },
  })

  registerAction({
    type: 'task.move',
    os: 'workspace',
    title: 'Move task',
    description: 'Change workspace task status',
    risk: 'safe',
    parallelSafe: true,
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('task.move'),
      taskId: taskIdOrRef,
      status: requiredTaskStatus,
    }),
    promptFields: 'taskId (UUID, KEY-N, or exact title), status',
    execute: async (input, ctx) => {
      const resolved = await resolveTaskOrFail(
        ctx.workspaceId!,
        input.taskId,
        ctx.conversationFocus?.lastModifiedTaskId,
      )
      if (!resolved.ok) return { ok: false, summary: resolved.reason }
      await updateWorkspaceTask(ctx.workspaceId!, resolved.task.id, {
        status: input.status as TaskStatus,
      })
      return {
        ok: true,
        summary: `Moved task to ${input.status}`,
        entities: [{ type: 'task', id: resolved.task.id }],
      }
    },
  })

  registerAction({
    type: 'task.update',
    os: 'workspace',
    title: 'Update task',
    description: 'Update workspace task fields',
    risk: 'safe',
    parallelSafe: true,
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('task.update'),
      taskId: taskIdOrRef,
      title: z.string().optional(),
      description: z.string().optional(),
      priority: optionalPriority,
      dueAt: z.string().nullable().optional(),
    }),
    promptFields: 'taskId (UUID, KEY-N, or exact title), title?, description?, priority?, dueAt?',
    execute: async (input, ctx) => {
      const resolved = await resolveTaskOrFail(
        ctx.workspaceId!,
        input.taskId,
        ctx.conversationFocus?.lastModifiedTaskId ?? ctx.conversationFocus?.lastCreatedTaskId,
      )
      if (!resolved.ok) return { ok: false, summary: resolved.reason }
      const dueAt = input.dueAt
      const updated = await updateWorkspaceTask(ctx.workspaceId!, resolved.task.id, {
        title: input.title,
        description: input.description,
        priority: input.priority as Priority | undefined,
        due_date: dueAt === undefined ? undefined : dueAt ? dueAt.slice(0, 10) : null,
        due_at: dueAt,
      })
      const ws = await getWorkspace(ctx.workspaceId!)
      const ref =
        formatWorkspaceTaskRef(ws.task_key, resolved.task.task_number) ?? resolved.task.id
      return {
        ok: true,
        summary: `Updated ${ref}${input.title?.trim() ? ` — “${input.title.trim()}”` : ''}`,
        entities: [{ type: 'task', id: resolved.task.id }],
        data: updated,
      }
    },
  })

  registerAction({
    type: 'task.schedule',
    os: 'workspace',
    title: 'Schedule task',
    description: 'Set or clear a workspace task due date/time',
    risk: 'safe',
    parallelSafe: true,
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('task.schedule'),
      taskId: taskIdOrRef,
      dueAt: z.string().nullable(),
    }),
    promptFields: 'taskId (UUID, KEY-N, or exact title), dueAt (ISO or null to clear)',
    execute: async (input, ctx) => {
      const resolved = await resolveTaskOrFail(
        ctx.workspaceId!,
        input.taskId,
        ctx.conversationFocus?.lastModifiedTaskId ?? ctx.conversationFocus?.lastCreatedTaskId,
      )
      if (!resolved.ok) return { ok: false, summary: resolved.reason }
      const dueAt = input.dueAt
      await updateWorkspaceTask(ctx.workspaceId!, resolved.task.id, {
        due_at: dueAt,
        due_date: dueAt ? dueAt.slice(0, 10) : null,
      })
      const ws = await getWorkspace(ctx.workspaceId!)
      const ref =
        formatWorkspaceTaskRef(ws.task_key, resolved.task.task_number) ?? resolved.task.id
      return {
        ok: true,
        summary: dueAt ? `Scheduled ${ref}` : `Cleared schedule on ${ref}`,
        entities: [{ type: 'task', id: resolved.task.id }],
      }
    },
  })

  registerAction({
    type: 'task.assign',
    os: 'workspace',
    title: 'Assign task',
    description: 'Assign a workspace task to a member',
    risk: 'confirm',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('task.assign'),
      taskId: taskIdOrRef,
      assigneeId: optionalUuid,
      assigneeName: z.string().min(1).optional(),
      teamId: optionalUuid,
      teamName: z.string().min(1).optional(),
    }),
    promptFields:
      'taskId (UUID, KEY-N, or title), assigneeId? or assigneeName?, teamId? or teamName?',
    execute: async (input, ctx) => {
      const workspaceId = ctx.workspaceId!
      const resolved = await resolveTaskOrFail(
        workspaceId,
        input.taskId,
        ctx.conversationFocus?.lastModifiedTaskId,
      )
      if (!resolved.ok) return { ok: false, summary: resolved.reason }

      let assigneeId = input.assigneeId ?? null
      let teamId = input.teamId ?? null

      if (!assigneeId && input.assigneeName) {
        const members = await listWorkspaceMembers(workspaceId)
        const needle = input.assigneeName.trim().toLowerCase()
        const matches = members.filter((row) => {
          const label = (
            row.display_name_override ||
            row.profiles?.display_name ||
            row.email ||
            ''
          ).toLowerCase()
          return label === needle || label.includes(needle) || needle.includes(label)
        })
        if (matches.length === 1) assigneeId = matches[0]!.user_id
        else if (matches.length > 1) {
          return {
            ok: false,
            summary: `Multiple members match “${input.assigneeName}”. Which one?`,
          }
        } else {
          return { ok: false, summary: `I couldn’t find member “${input.assigneeName}”.` }
        }
      }

      if (!teamId && input.teamName) {
        const { data: teams, error } = await supabase
          .from('workspace_teams')
          .select('id, name')
          .eq('workspace_id', workspaceId)
        if (error) throw error
        const needle = input.teamName.trim().toLowerCase()
        const matches = (teams ?? []).filter((team) => team.name.toLowerCase().includes(needle))
        if (matches.length === 1) teamId = matches[0]!.id
        else if (matches.length > 1) {
          return { ok: false, summary: `Multiple teams match “${input.teamName}”. Which one?` }
        } else {
          return { ok: false, summary: `I couldn’t find team “${input.teamName}”.` }
        }
      }

      if (!assigneeId && !teamId) {
        return {
          ok: false,
          summary: 'Provide an assignee (name or id) or a team (name or id).',
        }
      }

      await updateWorkspaceTask(workspaceId, resolved.task.id, {
        assignee_id: assigneeId,
        team_id: teamId,
      })
      const ws = await getWorkspace(workspaceId)
      const ref =
        formatWorkspaceTaskRef(ws.task_key, resolved.task.task_number) ?? resolved.task.id
      return {
        ok: true,
        summary: assigneeId
          ? `Assigned ${ref}`
          : `Assigned ${ref} to team`,
        entities: [{ type: 'task', id: resolved.task.id }],
      }
    },
  })

  registerAction({
    type: 'task.delete',
    os: 'workspace',
    title: 'Delete task',
    description: 'Delete a workspace task',
    risk: 'destructive',
    permission: editOk,
    inputSchema: z.object({ type: z.literal('task.delete'), taskId: taskIdOrRef }),
    promptFields: 'taskId (UUID or KEY-N)',
    execute: async (input, ctx) => {
      const resolved = await resolveTaskOrFail(ctx.workspaceId!, input.taskId)
      if (!resolved.ok) return { ok: false, summary: resolved.reason }
      await deleteWorkspaceTask(ctx.workspaceId!, resolved.task.id)
      return { ok: true, summary: `Deleted task ${input.taskId}` }
    },
  })

  registerAction({
    type: 'assignee.recommend',
    os: 'workspace',
    title: 'Recommend assignee',
    description: 'Use AI Load Balancer to recommend an assignee (does not assign)',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('assignee.recommend'),
      taskId: taskIdOrRef,
    }),
    promptFields: 'taskId (UUID or KEY-N)',
    execute: async (input, ctx) => {
      const resolved = await resolveTaskOrFail(ctx.workspaceId!, input.taskId)
      if (!resolved.ok) return { ok: false, summary: resolved.reason }
      const [tasks, members] = await Promise.all([
        listWorkspaceTasks(ctx.workspaceId!),
        listWorkspaceMembers(ctx.workspaceId!),
      ])
      const task = resolved.task
      const insight = analyzeAssignmentCandidates({
        members,
        tasks,
        priority: task.priority,
        dueAt: task.due_at,
        titleHint: task.title,
      })
      await recordWorkspaceActivityNote(ctx.workspaceId!, {
        summary: insight.best
          ? `Load balancer recommends ${insight.best.userId} (score ${insight.best.score}): ${insight.best.reasons.join('; ')}`
          : 'Load balancer found no suitable assignee',
        entityType: 'task',
        entityId: resolved.task.id,
        projectId: task.project_id,
        payload: insight as never,
      })
      return {
        ok: true,
        summary: insight.best
          ? `Recommended ${insight.best.userId}: ${insight.best.reasons.join('; ')}`
          : 'No recommendation',
        data: insight,
      }
    },
  })

  registerAction({
    type: 'project.search',
    os: 'workspace',
    title: 'Search projects',
    description: 'List or search workspace projects (returns real IDs)',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('project.search'),
      query: z.string().optional(),
    }),
    promptFields: 'query?',
    execute: async (input, ctx) => {
      const projects = await listWorkspaceProjects(ctx.workspaceId!)
      const q = input.query?.trim().toLowerCase()
      const matched = q
        ? projects.filter((project) => project.name.toLowerCase().includes(q))
        : projects
      const rows = matched.slice(0, 20).map((project) => ({
        id: project.id,
        name: project.name,
      }))
      return {
        ok: true,
        summary: rows.length
          ? `Found ${rows.length} workspace project(s)`
          : 'No matching workspace projects',
        data: { projects: rows },
      }
    },
  })

  registerAction({
    type: 'project.create',
    os: 'workspace',
    title: 'Create project',
    description:
      'Create a project in the current workspace. Name may match the workspace name — that is valid. workspaceId is injected from trusted context.',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('project.create'),
      name: z.string().min(1),
      description: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
    }),
    promptFields: 'name, description?, color?, icon?',
    execute: async (input, ctx) => {
      const name = input.name.trim()
      if (!name) {
        return { ok: false, summary: 'Project name is required' }
      }
      const projects = await listWorkspaceProjects(ctx.workspaceId!)
      const existing = projects.find(
        (project) => project.name.trim().toLowerCase() === name.toLowerCase(),
      )
      if (existing) {
        return {
          ok: true,
          summary: `Using existing project “${existing.name}”`,
          entities: [{ type: 'project', id: existing.id }],
          data: {
            ...existing,
            project_id: existing.id,
            project_name: existing.name,
            reused: true,
          },
        }
      }
      try {
        const project = await createWorkspaceProject(ctx.workspaceId!, {
          ...input,
          name,
        })
        return {
          ok: true,
          summary: `Created project ${name}`,
          entities: [{ type: 'project', id: project.id }],
          data: {
            ...project,
            project_id: project.id,
            project_name: project.name,
          },
        }
      } catch (error) {
        const message =
          error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505'
            ? `A project named “${name}” already exists in this workspace.`
            : error instanceof Error
              ? error.message
              : 'Failed to create project'
        return { ok: false, summary: message }
      }
    },
  })

  registerAction({
    type: 'project.update',
    os: 'workspace',
    title: 'Update project',
    description: 'Update a workspace project',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('project.update'),
      projectId: requiredUuid,
      name: z.string().optional(),
      description: z.string().optional(),
      completionPct: z.coerce.number().min(0).max(100).optional(),
      health: healthEnum.optional(),
    }),
    promptFields: 'projectId, name?, description?, completionPct?, health?',
    execute: async (input, ctx) => {
      await updateWorkspaceProject(ctx.workspaceId!, input.projectId, {
        name: input.name,
        description: input.description,
        completion_pct: input.completionPct,
        health: input.health,
      })
      return { ok: true, summary: `Updated project ${input.projectId}` }
    },
  })

  registerAction({
    type: 'project.delete',
    os: 'workspace',
    title: 'Delete project',
    description: 'Delete a workspace project',
    risk: 'destructive',
    permission: manageOk,
    inputSchema: z.object({ type: z.literal('project.delete'), projectId: requiredUuid }),
    promptFields: 'projectId',
    execute: async (input, ctx) => {
      await deleteWorkspaceProject(ctx.workspaceId!, input.projectId)
      return { ok: true, summary: `Deleted project ${input.projectId}` }
    },
  })

  registerAction({
    type: 'label.create',
    os: 'workspace',
    title: 'Create label',
    description: 'Create a shared workspace label',
    risk: 'safe',
    permission: manageOk,
    inputSchema: z.object({
      type: z.literal('label.create'),
      name: z.string().min(1),
      color: z.string().optional(),
    }),
    promptFields: 'name, color?',
    execute: async (input, ctx) => {
      const label = await createWorkspaceLabel(ctx.workspaceId!, input)
      return {
        ok: true,
        summary: `Created label ${input.name}`,
        entities: [{ type: 'label', id: label.id }],
      }
    },
  })

  registerAction({
    type: 'label.update',
    os: 'workspace',
    title: 'Update label',
    description: 'Rename or recolor a workspace label',
    risk: 'safe',
    permission: manageOk,
    inputSchema: z.object({
      type: z.literal('label.update'),
      labelId: requiredUuid,
      name: z.string().optional(),
      color: z.string().optional(),
    }),
    promptFields: 'labelId, name?, color?',
    execute: async (input, ctx) => {
      await updateWorkspaceLabel(ctx.workspaceId!, input.labelId, {
        name: input.name,
        color: input.color,
      })
      return { ok: true, summary: `Updated label ${input.labelId}` }
    },
  })

  registerAction({
    type: 'label.delete',
    os: 'workspace',
    title: 'Delete label',
    description: 'Delete a workspace label from all projects',
    risk: 'destructive',
    permission: manageOk,
    inputSchema: z.object({ type: z.literal('label.delete'), labelId: requiredUuid }),
    promptFields: 'labelId',
    execute: async (input, ctx) => {
      await deleteWorkspaceLabel(ctx.workspaceId!, input.labelId)
      return { ok: true, summary: `Deleted label ${input.labelId}` }
    },
  })

  registerAction({
    type: 'label.assign',
    os: 'workspace',
    title: 'Assign labels',
    description: 'Replace labels on a workspace project',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('label.assign'),
      projectId: requiredUuid,
      labelIds: z.array(requiredUuid),
    }),
    promptFields: 'projectId, labelIds[]',
    execute: async (input, ctx) => {
      await setProjectLabels(ctx.workspaceId!, input.projectId, input.labelIds)
      return { ok: true, summary: `Set labels on project ${input.projectId}` }
    },
  })

  registerAction({
    type: 'label.apply_named',
    os: 'workspace',
    title: 'Apply named label',
    description: 'Apply a label by name to a project (creates if missing; manage required to create)',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('label.apply_named'),
      projectId: requiredUuid,
      name: z.string().min(1),
      color: z.string().optional(),
    }),
    promptFields: 'projectId, name, color?',
    execute: async (input, ctx) => {
      const labels = await listWorkspaceLabels(ctx.workspaceId!)
      let label = labels.find((l) => l.name.toLowerCase() === input.name.toLowerCase())
      if (!label) {
        if (!manageOk(ctx)) throw new Error('Only owners/admins can create workspace labels')
        label = await createWorkspaceLabel(ctx.workspaceId!, {
          name: input.name,
          color: input.color,
        })
      }
      const current = await listProjectLabels(ctx.workspaceId!, input.projectId)
      const ids = Array.from(new Set([...current.map((l) => l.id), label.id]))
      await setProjectLabels(ctx.workspaceId!, input.projectId, ids)
      return { ok: true, summary: `Applied label ${label.name}` }
    },
  })

  registerAction({
    type: 'label.remove_named',
    os: 'workspace',
    title: 'Remove named label',
    description: 'Remove a label from a workspace project by name',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('label.remove_named'),
      projectId: requiredUuid,
      name: z.string().min(1),
    }),
    promptFields: 'projectId, name',
    execute: async (input, ctx) => {
      const labels = await listWorkspaceLabels(ctx.workspaceId!)
      const label = labels.find((l) => l.name.toLowerCase() === input.name.toLowerCase())
      if (!label) return { ok: true, summary: `Label ${input.name} not found — nothing to remove` }
      const current = await listProjectLabels(ctx.workspaceId!, input.projectId)
      await setProjectLabels(
        ctx.workspaceId!,
        input.projectId,
        current.filter((l) => l.id !== label.id).map((l) => l.id),
      )
      return { ok: true, summary: `Removed label ${label.name} from project` }
    },
  })

  registerAction({
    type: 'org.department.create',
    os: 'workspace',
    title: 'Create department',
    description: 'Create an organization department',
    risk: 'confirm',
    permission: manageOk,
    inputSchema: z.object({
      type: z.literal('org.department.create'),
      name: z.string().min(1),
      parentId: optionalUuid,
    }),
    promptFields: 'name, parentId?',
    execute: async (input, ctx) => {
      const dept = await createDepartment(ctx.workspaceId!, {
        name: input.name,
        parentId: input.parentId ?? null,
      })
      return {
        ok: true,
        summary: `Created department ${input.name}`,
        entities: [{ type: 'department', id: dept.id }],
      }
    },
  })

  registerAction({
    type: 'org.department.update',
    os: 'workspace',
    title: 'Update department',
    description: 'Rename or reparent a department',
    risk: 'confirm',
    permission: manageOk,
    inputSchema: z.object({
      type: z.literal('org.department.update'),
      departmentId: requiredUuid,
      name: z.string().optional(),
      parentId: optionalUuid.nullable().optional(),
    }),
    promptFields: 'departmentId, name?, parentId?',
    execute: async (input, ctx) => {
      await updateDepartment(ctx.workspaceId!, input.departmentId, {
        name: input.name,
        parent_id: input.parentId === undefined ? undefined : input.parentId,
      })
      return { ok: true, summary: `Updated department ${input.departmentId}` }
    },
  })

  registerAction({
    type: 'org.department.delete',
    os: 'workspace',
    title: 'Delete department',
    description: 'Delete a department',
    risk: 'destructive',
    permission: manageOk,
    inputSchema: z.object({
      type: z.literal('org.department.delete'),
      departmentId: requiredUuid,
    }),
    promptFields: 'departmentId',
    execute: async (input, ctx) => {
      await deleteDepartment(ctx.workspaceId!, input.departmentId)
      return { ok: true, summary: `Deleted department ${input.departmentId}` }
    },
  })

  registerAction({
    type: 'org.team.create',
    os: 'workspace',
    title: 'Create team',
    description: 'Create a team under a department',
    risk: 'confirm',
    permission: manageOk,
    inputSchema: z.object({
      type: z.literal('org.team.create'),
      name: z.string().min(1),
      departmentId: requiredUuid,
      leadUserId: optionalUuid,
    }),
    promptFields: 'name, departmentId, leadUserId?',
    execute: async (input, ctx) => {
      const team = await createTeam(ctx.workspaceId!, {
        name: input.name,
        departmentId: input.departmentId,
        leadUserId: input.leadUserId ?? null,
      })
      return {
        ok: true,
        summary: `Created team ${input.name}`,
        entities: [{ type: 'team', id: team.id }],
      }
    },
  })

  registerAction({
    type: 'org.team.set_lead',
    os: 'workspace',
    title: 'Set team lead',
    description: 'Assign a Team Lead',
    risk: 'confirm',
    permission: membersOk,
    inputSchema: z.object({
      type: z.literal('org.team.set_lead'),
      teamId: requiredUuid,
      leadUserId: requiredUuid,
    }),
    promptFields: 'teamId, leadUserId',
    execute: async (input, ctx) => {
      await updateTeam(ctx.workspaceId!, input.teamId, { lead_user_id: input.leadUserId })
      return { ok: true, summary: `Set team lead to ${input.leadUserId}` }
    },
  })

  registerAction({
    type: 'activity.note',
    os: 'workspace',
    title: 'Activity note',
    description: 'Record a workspace activity note',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('activity.note'),
      summary: z.string().min(1),
      entityType: z.string().optional(),
      entityId: optionalUuid,
      projectId: optionalUuid,
    }),
    promptFields: 'summary, entityType?, entityId?, projectId?',
    execute: async (input, ctx) => {
      await recordWorkspaceActivityNote(ctx.workspaceId!, input)
      return { ok: true, summary: 'Recorded activity note' }
    },
  })

  registerAction({
    type: 'documentation.generate',
    os: 'workspace',
    title: 'Generate documentation',
    description: 'Store generated documentation as activity',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('documentation.generate'),
      title: z.string().min(1),
      body: z.string().optional(),
      projectId: optionalUuid,
    }),
    promptFields: 'title, body?, projectId?',
    execute: async (input, ctx) => {
      await recordWorkspaceActivityNote(ctx.workspaceId!, {
        summary: `Documentation: ${input.title}`,
        entityType: 'documentation',
        entityId: input.projectId,
        projectId: input.projectId,
        payload: { title: input.title, body: input.body ?? '' },
      })
      return { ok: true, summary: `Stored documentation ${input.title}` }
    },
  })

  registerAction({
    type: 'meeting.summarize',
    os: 'workspace',
    title: 'Meeting summary',
    description: 'Store a meeting summary',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('meeting.summarize'),
      title: z.string().min(1),
      summary: z.string().min(1),
      projectId: optionalUuid,
    }),
    promptFields: 'title, summary, projectId?',
    execute: async (input, ctx) => {
      await recordWorkspaceActivityNote(ctx.workspaceId!, {
        summary: `Meeting: ${input.title}`,
        entityType: 'meeting',
        entityId: input.projectId,
        projectId: input.projectId,
        payload: { title: input.title, summary: input.summary },
      })
      return { ok: true, summary: `Stored meeting ${input.title}` }
    },
  })

  registerAction({
    type: 'release.notes',
    os: 'workspace',
    title: 'Release notes',
    description: 'Store release notes',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('release.notes'),
      title: z.string().min(1),
      body: z.string().min(1),
      projectId: optionalUuid,
    }),
    promptFields: 'title, body, projectId?',
    execute: async (input, ctx) => {
      await recordWorkspaceActivityNote(ctx.workspaceId!, {
        summary: `Release notes: ${input.title}`,
        entityType: 'release',
        entityId: input.projectId,
        projectId: input.projectId,
        payload: { title: input.title, body: input.body },
      })
      return { ok: true, summary: `Stored release notes ${input.title}` }
    },
  })

  registerAction({
    type: 'milestone.create',
    os: 'workspace',
    title: 'Create milestone',
    description: 'Record a milestone',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('milestone.create'),
      title: z.string().min(1),
      projectId: optionalUuid,
      dueAt: z.string().optional(),
    }),
    promptFields: 'title, projectId?, dueAt?',
    execute: async (input, ctx) => {
      await recordWorkspaceActivityNote(ctx.workspaceId!, {
        summary: `Milestone: ${input.title}`,
        entityType: 'milestone',
        entityId: input.projectId,
        projectId: input.projectId,
        payload: { title: input.title, dueAt: input.dueAt ?? null },
      })
      return { ok: true, summary: `Recorded milestone ${input.title}` }
    },
  })

  registerAction({
    type: 'report.generate',
    os: 'workspace',
    title: 'Generate report',
    description:
      'Generate a branded workspace report with metrics/charts from live Hilm data and store it in report history',
    risk: 'safe',
    permission: editOk,
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
            ]),
            kind: z.enum(['bar', 'pie']),
          }),
        )
        .max(8)
        .optional(),
    }),
    promptFields:
      'title, body (describe desired metrics/charts/fields), projectId?, projectName?, datePreset?, metrics?, charts:[{id,kind}]?',
    execute: async (input, ctx) => {
      const workspaceId = ctx.workspaceId!
      const userId = await requireUserId()
      const [{ data: profile }, { data: workspace }, projects, tasks, members] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
        supabase.from('workspaces').select('id, name, logo_url').eq('id', workspaceId).maybeSingle(),
        listWorkspaceProjects(workspaceId),
        listWorkspaceTasks(workspaceId),
        listWorkspaceMembers(workspaceId),
      ])
      const generatedBy = profile?.display_name?.trim() || 'Hilm user'
      const { customizeReportFromPrompt } = await import('@/features/reports/engine/aiCustomize')
      const { buildReportSnapshot } = await import('@/features/reports/engine/buildSnapshot')
      const { saveWorkspaceReport } = await import('@/features/reports/api')
      const { resolveMemberDisplayName } = await import('@/features/workspace-os/lib/member-display')
      let projectIds: string[] | 'all' = input.projectId ? [input.projectId] : 'all'
      if (!input.projectId && input.projectName?.trim()) {
        const needle = input.projectName.trim().toLowerCase()
        const match = projects.find((project) => project.name.trim().toLowerCase() === needle)
        if (match) projectIds = [match.id]
      }
      const customized = customizeReportFromPrompt('workspace', `${input.title}. ${input.body}`, {
        title: input.title,
        projectIds,
        datePreset: input.datePreset ?? 'this_week',
        metrics: (input.metrics ?? []) as never[],
        charts: input.charts,
      })
      const snapshot = buildReportSnapshot({
        os: 'workspace',
        config: customized.config,
        generatedBy,
        workspaceName: workspace?.name ?? null,
        workspaceId,
        logoUrl: workspace?.logo_url ?? null,
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
          assignee_id: task.assignee_id,
          department_id: task.department_id,
          team_id: task.team_id,
        })),
        members: members.map((member) => ({
          id: member.user_id,
          name: resolveMemberDisplayName({
            displayNameOverride: member.display_name_override,
            displayName: member.profiles?.display_name,
          }),
        })),
        aiPromptNotes: customized.notes,
      })
      const saved = await saveWorkspaceReport(workspaceId, snapshot)
      return {
        ok: true,
        summary: `Generated report ${snapshot.title}`,
        data: { reportId: saved.id, title: snapshot.title },
      }
    },
  })

  registerAction({
    type: 'mission.rebalance',
    os: 'workspace',
    title: 'Rebalance schedule',
    description: 'Apply due date changes to rebalance workload',
    risk: 'confirm',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('mission.rebalance'),
      assignments: z.array(
        z.object({
          taskId: requiredUuid,
          dueAt: z.string().nullable(),
          assigneeId: optionalUuid,
        }),
      ),
    }),
    promptFields: 'assignments[{taskId, dueAt, assigneeId?}]',
    execute: async (input, ctx) => {
      for (const row of input.assignments) {
        const dueAt = row.dueAt
        await updateWorkspaceTask(ctx.workspaceId!, row.taskId, {
          due_at: dueAt,
          due_date: dueAt ? dueAt.slice(0, 10) : dueAt,
          assignee_id: row.assigneeId,
        })
      }
      return {
        ok: true,
        summary: `Rebalanced ${input.assignments.length} tasks`,
      }
    },
  })

  registerAction({
    type: 'analytics.workload',
    os: 'workspace',
    title: 'Workload analytics',
    description: 'Analyze member/department workload and bottlenecks',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('analytics.workload'),
      focus: z.enum(['members', 'departments', 'overdue', 'projects']).optional(),
    }),
    promptFields: 'focus?',
    execute: async (input, ctx) => {
      const [tasks, members] = await Promise.all([
        listWorkspaceTasks(ctx.workspaceId!),
        listWorkspaceMembers(ctx.workspaceId!),
      ])
      const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'archived')
      const overdue = open.filter(
        (t) => t.due_at && new Date(t.due_at).getTime() < Date.now(),
      )
      const byAssignee = new Map<string, number>()
      for (const t of open) {
        if (!t.assignee_id) continue
        byAssignee.set(t.assignee_id, (byAssignee.get(t.assignee_id) ?? 0) + 1)
      }
      const ranked = [...byAssignee.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([userId, count]) => {
          const member = members.find((m) => m.user_id === userId)
          return {
            userId,
            name: member?.profiles?.display_name || userId,
            openCount: count,
          }
        })
      const body = {
        focus: input.focus ?? 'members',
        openCount: open.length,
        overdueCount: overdue.length,
        topLoaded: ranked,
      }
      await recordWorkspaceActivityNote(ctx.workspaceId!, {
        summary: `Workload: ${open.length} open, ${overdue.length} overdue. Top loaded: ${ranked.map((r) => `${r.name}(${r.openCount})`).join(', ') || 'n/a'}`,
        entityType: 'analytics',
        payload: body as never,
      })
      return {
        ok: true,
        summary: `Analyzed workload (${open.length} open / ${overdue.length} overdue)`,
        data: body,
      }
    },
  })

  registerAction({
    type: 'analytics.delivery_risk',
    os: 'workspace',
    title: 'Delivery risk',
    description: 'Identify projects and tasks at delivery risk',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({ type: z.literal('analytics.delivery_risk') }),
    promptFields: '(none)',
    execute: async (_input, ctx) => {
      const [tasks, projects] = await Promise.all([
        listWorkspaceTasks(ctx.workspaceId!),
        listWorkspaceProjects(ctx.workspaceId!),
      ])
      const riskyProjects = projects.filter((p) =>
        ['blocked', 'stalled', 'warning', 'critical'].includes(p.health),
      )
      const overdue = tasks.filter(
        (t) =>
          t.status !== 'done' &&
          t.status !== 'archived' &&
          t.due_at &&
          new Date(t.due_at).getTime() < Date.now(),
      )
      const summary = `Risk: ${riskyProjects.length} unhealthy projects, ${overdue.length} overdue tasks`
      await recordWorkspaceActivityNote(ctx.workspaceId!, {
        summary,
        entityType: 'analytics',
        payload: {
          riskyProjects: riskyProjects.map((p) => ({ id: p.id, name: p.name, health: p.health })),
          overdueIds: overdue.map((t) => t.id),
        } as never,
      })
      return { ok: true, summary, data: { riskyProjects, overdue } }
    },
  })
}
