import { z } from 'zod'
import { registerAction } from '@/features/ai/registry'
import {
  healthEnum,
  optionalUuid,
  priorityEnum,
  requiredUuid,
  taskStatusEnum,
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
  listWorkspaceMembers,
  listWorkspaceProjects,
  listWorkspaceTasks,
  recordWorkspaceActivityNote,
  updateWorkspaceProject,
  updateWorkspaceTask,
} from '@/features/workspace-os/api'
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
import type { Priority, TaskStatus } from '@/types/domain'

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
    inputSchema: z.object({ type: z.literal('task.complete'), taskId: requiredUuid }),
    promptFields: 'taskId',
    execute: async (input, ctx) => {
      await updateWorkspaceTask(ctx.workspaceId!, input.taskId, { status: 'done' })
      return { ok: true, summary: `Completed task ${input.taskId}` }
    },
  })

  registerAction({
    type: 'task.create',
    os: 'workspace',
    title: 'Create task',
    description: 'Create a workspace task',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('task.create'),
      title: z.string().min(1),
      description: z.string().optional(),
      projectId: optionalUuid,
      priority: priorityEnum.optional(),
      status: taskStatusEnum.optional(),
      dueAt: z.string().optional(),
      assigneeId: optionalUuid,
      departmentId: optionalUuid,
      teamId: optionalUuid,
    }),
    promptFields: 'title, description?, projectId?, priority?, status?, dueAt?, assigneeId?, departmentId?, teamId?',
    execute: async (input, ctx) => {
      const projectId =
        input.projectId ?? (await listWorkspaceProjects(ctx.workspaceId!))[0]?.id
      if (!projectId) throw new Error('Create a workspace project before creating a task')
      const task = await createWorkspaceTask(ctx.workspaceId!, {
        projectId,
        title: input.title,
        description: input.description,
        priority: input.priority as Priority | undefined,
        status: input.status as TaskStatus | undefined,
        dueDate: input.dueAt ?? null,
        assigneeId: input.assigneeId ?? null,
        departmentId: input.departmentId ?? null,
        teamId: input.teamId ?? null,
      })
      return {
        ok: true,
        summary: `Created task ${input.title}`,
        entities: [{ type: 'task', id: task.id }],
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
      taskId: requiredUuid,
      status: taskStatusEnum,
    }),
    promptFields: 'taskId, status',
    execute: async (input, ctx) => {
      await updateWorkspaceTask(ctx.workspaceId!, input.taskId, {
        status: input.status as TaskStatus,
      })
      return { ok: true, summary: `Moved task to ${input.status}` }
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
      taskId: requiredUuid,
      title: z.string().optional(),
      description: z.string().optional(),
      priority: priorityEnum.optional(),
      dueAt: z.string().nullable().optional(),
    }),
    promptFields: 'taskId, title?, description?, priority?, dueAt?',
    execute: async (input, ctx) => {
      await updateWorkspaceTask(ctx.workspaceId!, input.taskId, {
        title: input.title,
        description: input.description,
        priority: input.priority as Priority | undefined,
        due_date: input.dueAt,
        due_at: input.dueAt,
      })
      return { ok: true, summary: `Updated task ${input.taskId}` }
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
      taskId: requiredUuid,
      assigneeId: requiredUuid,
    }),
    promptFields: 'taskId, assigneeId',
    execute: async (input, ctx) => {
      await updateWorkspaceTask(ctx.workspaceId!, input.taskId, {
        assignee_id: input.assigneeId,
      })
      return { ok: true, summary: `Assigned task to ${input.assigneeId}` }
    },
  })

  registerAction({
    type: 'task.delete',
    os: 'workspace',
    title: 'Delete task',
    description: 'Delete a workspace task',
    risk: 'destructive',
    permission: editOk,
    inputSchema: z.object({ type: z.literal('task.delete'), taskId: requiredUuid }),
    promptFields: 'taskId',
    execute: async (input, ctx) => {
      await deleteWorkspaceTask(ctx.workspaceId!, input.taskId)
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
      taskId: requiredUuid,
    }),
    promptFields: 'taskId',
    execute: async (input, ctx) => {
      const [tasks, members] = await Promise.all([
        listWorkspaceTasks(ctx.workspaceId!),
        listWorkspaceMembers(ctx.workspaceId!),
      ])
      const task = tasks.find((t) => t.id === input.taskId)
      if (!task) throw new Error('Task not found')
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
        entityId: input.taskId,
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
    type: 'project.create',
    os: 'workspace',
    title: 'Create project',
    description: 'Create a workspace project',
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
      const project = await createWorkspaceProject(ctx.workspaceId!, input)
      return {
        ok: true,
        summary: `Created project ${input.name}`,
        entities: [{ type: 'project', id: project.id }],
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
    description: 'Generate a workspace status/progress report',
    risk: 'safe',
    permission: editOk,
    inputSchema: z.object({
      type: z.literal('report.generate'),
      title: z.string().min(1),
      body: z.string().min(1),
      projectId: optionalUuid,
    }),
    promptFields: 'title, body, projectId?',
    execute: async (input, ctx) => {
      await recordWorkspaceActivityNote(ctx.workspaceId!, {
        summary: `Report: ${input.title}`,
        entityType: 'report',
        entityId: input.projectId,
        projectId: input.projectId,
        payload: { title: input.title, body: input.body },
      })
      return { ok: true, summary: `Generated report ${input.title}` }
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
        await updateWorkspaceTask(ctx.workspaceId!, row.taskId, {
          due_at: row.dueAt,
          due_date: row.dueAt,
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
