import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { combineDueAt, computeRemindAt, type ReminderType } from '@/features/tasks/reminders'
import { resolveMemberDisplayName } from '@/features/workspace-os/lib/member-display'
import type { Tables, Updates } from '@/types/database'
import type { WorkspaceRole } from '@/features/workspace-os/lib/permissions'

export const workspaceKeys = {
  all: ['workspace-os'] as const,
  list: () => [...workspaceKeys.all, 'list'] as const,
  detail: (id: string) => [...workspaceKeys.all, 'detail', id] as const,
  members: (id: string) => [...workspaceKeys.all, 'members', id] as const,
  projects: (id: string) => [...workspaceKeys.all, 'projects', id] as const,
  project: (workspaceId: string, projectId: string) =>
    [...workspaceKeys.all, 'project', workspaceId, projectId] as const,
  tasks: (id: string) => [...workspaceKeys.all, 'tasks', id] as const,
  task: (workspaceId: string, taskId: string) =>
    [...workspaceKeys.all, 'task', workspaceId, taskId] as const,
  activity: (id: string) => [...workspaceKeys.all, 'activity', id] as const,
  home: (id: string) => [...workspaceKeys.all, 'home', id, 'v2'] as const,
  memberSettings: (id: string) => [...workspaceKeys.all, 'member-settings', id] as const,
}

export type Workspace = Tables<'workspaces'>
export type WorkspaceMember = Tables<'workspace_members'> & {
  email?: string | null
  display_name_override?: string | null
  last_active_at?: string | null
  profiles?: {
    display_name: string | null
    avatar_url: string | null
    email?: string | null
  } | null
}
export type WorkspaceProject = Tables<'workspace_projects'>
export type WorkspaceTaskAssignee = {
  id: string
  display_name: string
  avatar_url: string | null
}
export type WorkspaceTask = Tables<'workspace_tasks'> & {
  workspace_projects?: Pick<WorkspaceProject, 'id' | 'name' | 'color' | 'icon'> | null
  assignee?: WorkspaceTaskAssignee | null
  assignment?: import('@/features/workspace-os/lib/org-visibility').TaskAssignmentInfo | null
}
export type WorkspaceActivity = Tables<'workspace_activity_events'>

async function recordWsActivity(input: {
  workspaceId: string
  eventType: string
  summary: string
  entityType?: string
  entityId?: string
  payload?: Record<string, unknown>
}) {
  const userId = await requireUserId()
  await supabase.from('workspace_activity_events').insert({
    workspace_id: input.workspaceId,
    actor_id: userId,
    event_type: input.eventType,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    summary: input.summary,
    payload: (input.payload ?? {}) as import('@/types/database').Json,
  })
}

export async function listMyWorkspaces() {
  const userId = await requireUserId()
  const { data: memberships, error } = await supabase
    .from('workspace_members')
    .select('role, workspace_id')
    .eq('user_id', userId)
  if (error) throw error
  const rows = memberships ?? []
  if (!rows.length) return []
  const { data: workspaces, error: wsError } = await supabase
    .from('workspaces')
    .select('*')
    .in(
      'id',
      rows.map((row) => row.workspace_id),
    )
  if (wsError) throw wsError
  const roleById = new Map(rows.map((row) => [row.workspace_id, row.role as WorkspaceRole]))
  return ((workspaces ?? []) as Workspace[]).map((workspace) => ({
    ...workspace,
    my_role: roleById.get(workspace.id) ?? ('member' as WorkspaceRole),
  }))
}

export async function getWorkspace(id: string) {
  const userId = await requireUserId()
  const { data: membership, error: memError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (memError) throw memError
  if (!membership) throw new Error('Workspace not found')

  const { data, error } = await supabase.from('workspaces').select('*').eq('id', id).single()
  if (error) throw error
  return { ...(data as Workspace), my_role: membership.role as WorkspaceRole }
}

export async function createWorkspace(input: {
  name: string
  description?: string
  color?: string
}) {
  const { data, error } = await supabase.rpc('create_workspace', {
    p_name: input.name,
    p_description: input.description ?? null,
    p_color: input.color ?? '#60a5fa',
  })
  if (error) throw error
  return data as Workspace
}

export async function joinWorkspaceByInvite(code: string) {
  const { data, error } = await supabase.rpc('join_workspace_by_invite', {
    p_code: code,
  })
  if (error) throw error
  return data as Workspace
}

export async function updateWorkspace(
  id: string,
  patch: Pick<Updates<'workspaces'>, 'name' | 'description' | 'color' | 'logo_url'>,
) {
  const { data, error } = await supabase
    .from('workspaces')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  await recordWsActivity({
    workspaceId: id,
    eventType: 'workspace.updated',
    summary: 'Workspace settings updated',
    entityType: 'workspace',
    entityId: id,
  })
  return data as Workspace
}

export async function deleteWorkspace(id: string) {
  const { error } = await supabase.from('workspaces').delete().eq('id', id)
  if (error) throw error
}

export async function regenerateInviteCode(workspaceId: string) {
  const { data, error } = await supabase.rpc('regenerate_workspace_invite', {
    p_workspace_id: workspaceId,
  })
  if (error) throw error
  return data as string
}

export async function listWorkspaceMembers(workspaceId: string) {
  const { data, error } = await supabase.rpc('list_workspace_member_directory', {
    p_workspace_id: workspaceId,
  })

  if (!error && data) {
    return (data as Array<{
      user_id: string
      role: WorkspaceRole
      joined_at: string
      display_name: string | null
      avatar_url: string | null
      email: string | null
      display_name_override: string | null
      last_active_at: string | null
    }>).map((row) => ({
      workspace_id: workspaceId,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      email: row.email,
      display_name_override: row.display_name_override,
      last_active_at: row.last_active_at,
      profiles: {
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        email: row.email,
      },
    })) as WorkspaceMember[]
  }

  // Fallback if directory RPC is unavailable
  const { data: rows, error: membersError } = await supabase
    .from('workspace_members')
    .select('workspace_id, user_id, role, joined_at')
    .eq('workspace_id', workspaceId)
    .order('joined_at')
  if (membersError) throw membersError
  const memberRows = rows ?? []
  const ids = memberRows.map((row) => row.user_id)
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', ids)
    : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] }
  const map = new Map((profiles ?? []).map((p) => [p.id, p]))
  return memberRows.map((row) => ({
    ...row,
    email: null,
    display_name_override: null,
    last_active_at: null,
    profiles: map.get(row.user_id)
      ? {
          display_name: map.get(row.user_id)!.display_name,
          avatar_url: map.get(row.user_id)!.avatar_url,
          email: null,
        }
      : null,
  })) as WorkspaceMember[]
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
) {
  const { error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) throw error
  await recordWsActivity({
    workspaceId,
    eventType: 'member.role_changed',
    summary: `Member role changed to ${role}`,
    entityType: 'member',
    entityId: userId,
    payload: { role },
  })
}

export async function removeMember(workspaceId: string, userId: string) {
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) throw error
  await recordWsActivity({
    workspaceId,
    eventType: 'member.removed',
    summary: 'Member removed',
    entityType: 'member',
    entityId: userId,
  })
}

export async function transferOwnership(workspaceId: string, newOwnerId: string) {
  const userId = await requireUserId()
  const { error: demoteError } = await supabase
    .from('workspace_members')
    .update({ role: 'admin' })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (demoteError) throw demoteError

  const { error: promoteError } = await supabase
    .from('workspace_members')
    .update({ role: 'owner' })
    .eq('workspace_id', workspaceId)
    .eq('user_id', newOwnerId)
  if (promoteError) throw promoteError

  const { error: wsError } = await supabase
    .from('workspaces')
    .update({ owner_id: newOwnerId })
    .eq('id', workspaceId)
  if (wsError) throw wsError

  await recordWsActivity({
    workspaceId,
    eventType: 'ownership.transferred',
    summary: 'Ownership transferred',
    entityType: 'member',
    entityId: newOwnerId,
  })
}

export async function listWorkspaceProjects(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_projects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data as WorkspaceProject[]
}

export async function getWorkspaceProject(workspaceId: string, projectId: string) {
  const { data, error } = await supabase
    .from('workspace_projects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', projectId)
    .single()
  if (error) throw error
  return data as WorkspaceProject
}

export async function createWorkspaceProject(
  workspaceId: string,
  input: { name: string; description?: string; color?: string; icon?: string },
) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('workspace_projects')
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? '#60a5fa',
      icon: input.icon ?? 'folder',
    })
    .select('*')
    .single()
  if (error) throw error
  await recordWsActivity({
    workspaceId,
    eventType: 'project.created',
    summary: `Project “${input.name}” created`,
    entityType: 'project',
    entityId: data.id,
  })
  return data as WorkspaceProject
}

export async function updateWorkspaceProject(
  workspaceId: string,
  projectId: string,
  patch: Updates<'workspace_projects'>,
) {
  const { data, error } = await supabase
    .from('workspace_projects')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .eq('id', projectId)
    .select('*')
    .single()
  if (error) throw error
  await recordWsActivity({
    workspaceId,
    eventType: 'project.updated',
    summary: 'Project updated',
    entityType: 'project',
    entityId: projectId,
  })
  return data as WorkspaceProject
}

export async function deleteWorkspaceProject(workspaceId: string, projectId: string) {
  const { error } = await supabase
    .from('workspace_projects')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', projectId)
  if (error) throw error
  await recordWsActivity({
    workspaceId,
    eventType: 'project.deleted',
    summary: 'Project deleted',
    entityType: 'project',
    entityId: projectId,
  })
}

export async function listWorkspaceTasks(workspaceId: string) {
  const [{ data, error }, projects, members, departments, teams] = await Promise.all([
    supabase
      .from('workspace_tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }),
    listWorkspaceProjects(workspaceId),
    listWorkspaceMembers(workspaceId),
    supabase
      .from('workspace_departments')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .then((r) => r.data ?? []),
    supabase
      .from('workspace_teams')
      .select('id, name, department_id')
      .eq('workspace_id', workspaceId)
      .then((r) => r.data ?? []),
  ])
  if (error) throw error
  const projectMap = new Map(projects.map((project) => [project.id, project]))
  const memberMap = new Map(members.map((member) => [member.user_id, member]))
  const deptMap = new Map(departments.map((d) => [d.id, d]))
  const teamMap = new Map(teams.map((t) => [t.id, t]))

  return (data ?? []).map((task) => {
    const project = projectMap.get(task.project_id)
    const member = task.assignee_id ? memberMap.get(task.assignee_id) : null
    const team = task.team_id ? teamMap.get(task.team_id) : null
    const department = task.department_id
      ? deptMap.get(task.department_id)
      : team?.department_id
        ? deptMap.get(team.department_id)
        : null
    const assignee = member
      ? {
          id: member.user_id,
          display_name: resolveMemberDisplayName({
            displayNameOverride: member.display_name_override,
            displayName: member.profiles?.display_name,
            email: member.email ?? member.profiles?.email,
          }),
          avatar_url: member.profiles?.avatar_url ?? null,
        }
      : null
    const state = assignee
      ? ('individual' as const)
      : task.team_id || task.department_id
        ? ('team' as const)
        : ('unassigned' as const)
    return {
      ...task,
      workspace_projects: project
        ? { id: project.id, name: project.name, color: project.color, icon: project.icon }
        : null,
      assignee,
      assignment: {
        state,
        department: department ? { id: department.id, name: department.name } : null,
        team: team ? { id: team.id, name: team.name } : null,
        assignee,
      },
    } as WorkspaceTask
  })
}

export async function getWorkspaceTask(workspaceId: string, taskId: string) {
  const tasks = await listWorkspaceTasks(workspaceId)
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new Error('Task not found')
  return task
}

export async function createWorkspaceTask(
  workspaceId: string,
  input: {
    projectId: string
    title: string
    description?: string
    priority?: WorkspaceTask['priority']
    status?: WorkspaceTask['status']
    dueDate?: string | null
    dueAt?: string | null
    assigneeId?: string | null
    departmentId?: string | null
    teamId?: string | null
    reminderType?: ReminderType | null
  },
) {
  const userId = await requireUserId()
  const dueDate = input.dueDate?.trim() || null
  const dueAt = input.dueAt ?? combineDueAt(dueDate)
  const reminderType = input.reminderType ?? '1h'
  const reminderAt = computeRemindAt(dueAt, reminderType)

  const assignment = await resolveOrgAssignment(workspaceId, {
    departmentId: input.departmentId ?? null,
    teamId: input.teamId ?? null,
    assigneeId: input.assigneeId ?? null,
  })

  const { data, error } = await supabase
    .from('workspace_tasks')
    .insert({
      workspace_id: workspaceId,
      project_id: input.projectId,
      created_by: userId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'none',
      status: input.status ?? 'todo',
      due_date: dueDate,
      due_at: dueAt,
      assignee_id: assignment.assigneeId,
      department_id: assignment.departmentId,
      team_id: assignment.teamId,
      reminder_type: dueDate ? reminderType : null,
      reminder_at: reminderAt,
    })
    .select('*')
    .single()
  if (error) throw error

  if (assignment.assigneeId && assignment.assigneeId !== userId) {
    await supabase.from('notifications').insert({
      user_id: assignment.assigneeId,
      channel: 'in_app',
      type: 'workspace.task.assigned',
      title: 'Task assigned',
      body: `You were assigned "${input.title}"`,
      entity_type: 'workspace_task',
      entity_id: data.id,
      href: `/workspace/${workspaceId}/tasks/${data.id}`,
    })
  }
  for (const leadId of assignment.notifyLeadIds) {
    if (leadId === assignment.assigneeId) continue
    await supabase.from('notifications').insert({
      user_id: leadId,
      channel: 'in_app',
      type: 'workspace.task.lead',
      title: 'New task for your team',
      body: `"${input.title}" was assigned to your team — open the assignment queue to distribute.`,
      entity_type: 'workspace_task',
      entity_id: data.id,
      href: `/workspace/${workspaceId}/team-lead`,
    })
  }

  const eventType = assignment.assigneeId
    ? 'assigned_member'
    : assignment.teamId || assignment.departmentId
      ? 'assigned_team'
      : 'unassigned'
  await recordAssignmentEvent(workspaceId, {
    taskId: data.id,
    eventType,
    summary: assignment.assigneeId
      ? `Assigned to member`
      : assignment.teamId
        ? `Assigned to team for distribution`
        : assignment.departmentId
          ? `Assigned to department`
          : `Created unassigned`,
    toDepartmentId: assignment.departmentId,
    toTeamId: assignment.teamId,
    toAssigneeId: assignment.assigneeId,
    payload: { title: input.title },
  })

  await recordWsActivity({
    workspaceId,
    eventType: 'task.created',
    summary: `Task “${input.title}” created`,
    entityType: 'task',
    entityId: data.id,
  })
  return getWorkspaceTask(workspaceId, data.id)
}

async function resolveOrgAssignment(
  workspaceId: string,
  input: {
    departmentId: string | null
    teamId: string | null
    assigneeId: string | null
  },
): Promise<{
  departmentId: string | null
  teamId: string | null
  assigneeId: string | null
  notifyLeadIds: string[]
}> {
  let departmentId = input.departmentId
  let teamId = input.teamId
  // Team Lead is NEVER auto-assigned as the worker — only notified to distribute.
  const assigneeId = input.assigneeId
  const notifyLeadIds: string[] = []

  if (teamId) {
    const { data: team } = await supabase
      .from('workspace_teams')
      .select('id, department_id, lead_user_id')
      .eq('workspace_id', workspaceId)
      .eq('id', teamId)
      .maybeSingle()
    if (team) {
      departmentId = departmentId ?? team.department_id
      if (team.lead_user_id) notifyLeadIds.push(team.lead_user_id)
    }
  } else if (departmentId) {
    const { data: teams } = await supabase
      .from('workspace_teams')
      .select('id, lead_user_id')
      .eq('workspace_id', workspaceId)
      .eq('department_id', departmentId)
    for (const team of teams ?? []) {
      if (team.lead_user_id) notifyLeadIds.push(team.lead_user_id)
    }
  }

  return {
    departmentId,
    teamId,
    assigneeId,
    notifyLeadIds: [...new Set(notifyLeadIds)],
  }
}

export async function recordAssignmentEvent(
  workspaceId: string,
  input: {
    taskId: string
    eventType: string
    summary: string
    fromDepartmentId?: string | null
    toDepartmentId?: string | null
    fromTeamId?: string | null
    toTeamId?: string | null
    fromAssigneeId?: string | null
    toAssigneeId?: string | null
    payload?: Record<string, unknown>
  },
) {
  const userId = await requireUserId()
  await supabase.from('workspace_assignment_events').insert({
    workspace_id: workspaceId,
    task_id: input.taskId,
    actor_id: userId,
    event_type: input.eventType,
    from_department_id: input.fromDepartmentId ?? null,
    to_department_id: input.toDepartmentId ?? null,
    from_team_id: input.fromTeamId ?? null,
    to_team_id: input.toTeamId ?? null,
    from_assignee_id: input.fromAssigneeId ?? null,
    to_assignee_id: input.toAssigneeId ?? null,
    summary: input.summary,
    payload: (input.payload ?? {}) as import('@/types/database').Json,
  })
}

export async function listAssignmentEvents(workspaceId: string, taskId: string) {
  const { data, error } = await supabase
    .from('workspace_assignment_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function updateWorkspaceTask(
  workspaceId: string,
  taskId: string,
  patch: Updates<'workspace_tasks'>,
) {
  const before = await getWorkspaceTask(workspaceId, taskId)
  const next = { ...patch }
  if (patch.status === 'done' && patch.completed_at === undefined) {
    next.completed_at = new Date().toISOString()
  }
  if (patch.status && patch.status !== 'done') {
    next.completed_at = null
  }

  const assignmentChanging =
    patch.assignee_id !== undefined ||
    patch.department_id !== undefined ||
    patch.team_id !== undefined

  if (assignmentChanging) {
    const resolved = await resolveOrgAssignment(workspaceId, {
      departmentId:
        patch.department_id !== undefined ? patch.department_id : before.department_id,
      teamId: patch.team_id !== undefined ? patch.team_id : before.team_id,
      assigneeId: patch.assignee_id !== undefined ? patch.assignee_id : before.assignee_id,
    })
    next.department_id = resolved.departmentId
    next.team_id = resolved.teamId
    next.assignee_id = resolved.assigneeId

    for (const leadId of resolved.notifyLeadIds) {
      if (leadId === resolved.assigneeId) continue
      if (before.team_id === resolved.teamId && before.department_id === resolved.departmentId) {
        if (before.assignee_id === resolved.assigneeId) continue
        // Only notify lead when newly routed to team without member
        if (resolved.assigneeId) continue
      }
      await supabase.from('notifications').insert({
        user_id: leadId,
        channel: 'in_app',
        type: 'workspace.task.lead',
        title: 'New task for your team',
        body: `"${before.title}" needs distribution — open the assignment queue.`,
        entity_type: 'workspace_task',
        entity_id: taskId,
        href: `/workspace/${workspaceId}/team-lead`,
      })
    }

    if (resolved.assigneeId && resolved.assigneeId !== before.assignee_id) {
      const userId = await requireUserId()
      if (resolved.assigneeId !== userId) {
        await supabase.from('notifications').insert({
          user_id: resolved.assigneeId,
          channel: 'in_app',
          type: 'workspace.task.assigned',
          title: 'Task assigned',
          body: `You were assigned "${before.title}"`,
          entity_type: 'workspace_task',
          entity_id: taskId,
          href: `/workspace/${workspaceId}/tasks/${taskId}`,
        })
      }
    }
  }

  const { error } = await supabase
    .from('workspace_tasks')
    .update(next)
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
  if (error) throw error

  if (assignmentChanging) {
    await recordAssignmentEvent(workspaceId, {
      taskId,
      eventType: next.assignee_id
        ? 'assigned_member'
        : next.team_id || next.department_id
          ? 'assigned_team'
          : 'unassigned',
      summary: next.assignee_id
        ? 'Assigned to member'
        : next.team_id
          ? 'Assigned to team for distribution'
          : next.department_id
            ? 'Assigned to department'
            : 'Cleared assignment',
      fromDepartmentId: before.department_id,
      toDepartmentId: (next.department_id as string | null | undefined) ?? before.department_id,
      fromTeamId: before.team_id,
      toTeamId: (next.team_id as string | null | undefined) ?? before.team_id,
      fromAssigneeId: before.assignee_id,
      toAssigneeId: (next.assignee_id as string | null | undefined) ?? null,
    })
  }

  await recordWsActivity({
    workspaceId,
    eventType: 'task.updated',
    summary: 'Task updated',
    entityType: 'task',
    entityId: taskId,
  })
  return getWorkspaceTask(workspaceId, taskId)
}

export async function deleteWorkspaceTask(workspaceId: string, taskId: string) {
  const { error } = await supabase
    .from('workspace_tasks')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
  if (error) throw error
  await recordWsActivity({
    workspaceId,
    eventType: 'task.deleted',
    summary: 'Task deleted',
    entityType: 'task',
    entityId: taskId,
  })
}

export async function recordWorkspaceActivityNote(
  workspaceId: string,
  input: {
    summary: string
    entityType?: string
    entityId?: string
    projectId?: string
    payload?: Record<string, unknown>
  },
) {
  await recordWsActivity({
    workspaceId,
    eventType: 'ai.note',
    summary: input.summary,
    entityType: input.entityType ?? 'ai_note',
    entityId: input.entityId ?? input.projectId,
    payload: {
      ...(input.payload ?? {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
  })
  return { recorded: true }
}

export async function leaveWorkspace(workspaceId: string) {
  const userId = await requireUserId()
  const { data: membership, error: memError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (memError) throw memError
  if (!membership) throw new Error('Not a member of this workspace')
  if (membership.role === 'owner') {
    throw new Error('Transfer ownership before leaving this workspace')
  }
  await removeMember(workspaceId, userId)
}

export type WorkspaceMemberSettings = Tables<'workspace_member_settings'>

export async function getWorkspaceMemberSettings(workspaceId: string) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('workspace_member_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as WorkspaceMemberSettings | null) ?? null
}

export async function listAllMemberSettings(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_member_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
  if (error) throw error
  return (data ?? []) as WorkspaceMemberSettings[]
}

export async function upsertWorkspaceMemberSettings(
  workspaceId: string,
  patch: {
    displayNameOverride?: string | null
    avatarUrl?: string | null
    notificationPrefs?: Record<string, unknown>
    appearancePrefs?: Record<string, unknown>
    aiPrefs?: Record<string, unknown>
    departmentId?: string | null
    skills?: string[]
    availability?: Record<string, unknown>
  },
) {
  const userId = await requireUserId()
  const existing = await getWorkspaceMemberSettings(workspaceId)
  const payload = {
    workspace_id: workspaceId,
    user_id: userId,
    display_name_override:
      patch.displayNameOverride !== undefined
        ? patch.displayNameOverride
        : (existing?.display_name_override ?? null),
    avatar_url: patch.avatarUrl !== undefined ? patch.avatarUrl : (existing?.avatar_url ?? null),
    notification_prefs: (patch.notificationPrefs ??
      existing?.notification_prefs ??
      {}) as import('@/types/database').Json,
    appearance_prefs: (patch.appearancePrefs ??
      existing?.appearance_prefs ??
      {}) as import('@/types/database').Json,
    ai_prefs: (patch.aiPrefs ?? existing?.ai_prefs ?? {}) as import('@/types/database').Json,
    department_id:
      patch.departmentId !== undefined ? patch.departmentId : (existing?.department_id ?? null),
    skills: patch.skills !== undefined ? patch.skills : (existing?.skills ?? []),
    availability: (patch.availability ??
      existing?.availability ??
      {}) as import('@/types/database').Json,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from('workspace_member_settings')
    .upsert(payload, { onConflict: 'workspace_id,user_id' })
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceMemberSettings
}

export async function listWorkspaceActivity(workspaceId: string, limit = 40) {
  const { data, error } = await supabase
    .from('workspace_activity_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as WorkspaceActivity[]
}

export async function getWorkspaceHome(workspaceId: string) {
  const [membersRaw, projectsRaw, tasksRaw, activityRaw] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    listWorkspaceProjects(workspaceId),
    listWorkspaceTasks(workspaceId),
    listWorkspaceActivity(workspaceId, 10),
  ])
  const members = Array.isArray(membersRaw) ? membersRaw : []
  const projects = Array.isArray(projectsRaw) ? projectsRaw : []
  const tasks = Array.isArray(tasksRaw) ? tasksRaw : []
  const activity = Array.isArray(activityRaw) ? activityRaw : []
  const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'archived')
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const dueKey = (task: WorkspaceTask) => {
    if (task.due_date) return task.due_date.slice(0, 10)
    if (task.due_at) {
      const d = new Date(task.due_at)
      if (Number.isNaN(d.getTime())) return null
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    return null
  }

  const priorityRank: Record<string, number> = {
    urgent: 5,
    high: 4,
    medium: 3,
    low: 2,
    none: 1,
  }

  const overdueTasks = openTasks
    .filter((task) => {
      const key = dueKey(task)
      return key != null && key < todayKey
    })
    .sort((a, b) => (dueKey(a) ?? '').localeCompare(dueKey(b) ?? ''))

  const todayTasks = openTasks
    .filter((task) => dueKey(task) === todayKey)
    .sort((a, b) => (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0))

  const upcoming = openTasks
    .filter((task) => {
      const key = dueKey(task)
      return key != null && key > todayKey
    })
    .sort((a, b) => (dueKey(a) ?? '').localeCompare(dueKey(b) ?? ''))
    .slice(0, 8)

  const focus =
    overdueTasks[0] ??
    todayTasks[0] ??
    [...openTasks].sort(
      (a, b) => (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0),
    )[0] ??
    null

  const projectCards = projects.slice(0, 6).map((project) => {
    const projectTasks = tasks.filter((task) => task.project_id === project.id)
    const open = projectTasks.filter((task) => task.status !== 'done' && task.status !== 'archived')
    const overdue = open.filter((task) => {
      const key = dueKey(task)
      return key != null && key < todayKey
    }).length
    return {
      ...project,
      remainingTasks: open.length,
      overdueCount: overdue,
      nextDeadline:
        open
          .map((task) => dueKey(task))
          .filter((key): key is string => Boolean(key))
          .sort()[0] ?? null,
    }
  })

  return {
    memberCount: members.length,
    projectCount: projects.length,
    openTaskCount: openTasks.length,
    doneTaskCount: tasks.filter((task) => task.status === 'done').length,
    overdueCount: overdueTasks.length,
    focus,
    overdueTasks: overdueTasks.slice(0, 4),
    todayTasks,
    upcoming,
    recentActivity: activity,
    projects: projectCards,
    openTasks: openTasks.slice(0, 6),
    members: members.slice(0, 8),
  }
}

export function inviteLinkForCode(code: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/workspace?join=${encodeURIComponent(code)}`
}
