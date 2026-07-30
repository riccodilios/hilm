import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
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
  home: (id: string) => [...workspaceKeys.all, 'home', id] as const,
}

export type Workspace = Tables<'workspaces'>
export type WorkspaceMember = Tables<'workspace_members'> & {
  profiles?: { display_name: string | null; avatar_url: string | null } | null
}
export type WorkspaceProject = Tables<'workspace_projects'>
export type WorkspaceTask = Tables<'workspace_tasks'> & {
  workspace_projects?: Pick<WorkspaceProject, 'id' | 'name' | 'color' | 'icon'> | null
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
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, user_id, role, joined_at')
    .eq('workspace_id', workspaceId)
    .order('joined_at')
  if (error) throw error
  const rows = data ?? []
  const ids = rows.map((row) => row.user_id)
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', ids)
    : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] }
  const map = new Map((profiles ?? []).map((p) => [p.id, p]))
  return rows.map((row) => ({
    ...row,
    profiles: map.get(row.user_id)
      ? {
          display_name: map.get(row.user_id)!.display_name,
          avatar_url: map.get(row.user_id)!.avatar_url,
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
  const [{ data, error }, projects] = await Promise.all([
    supabase
      .from('workspace_tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }),
    listWorkspaceProjects(workspaceId),
  ])
  if (error) throw error
  const projectMap = new Map(projects.map((project) => [project.id, project]))
  return (data ?? []).map((task) => {
    const project = projectMap.get(task.project_id)
    return {
      ...task,
      workspace_projects: project
        ? { id: project.id, name: project.name, color: project.color, icon: project.icon }
        : null,
    } as WorkspaceTask
  })
}

export async function getWorkspaceTask(workspaceId: string, taskId: string) {
  const { data, error } = await supabase
    .from('workspace_tasks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .single()
  if (error) throw error
  const project = await getWorkspaceProject(workspaceId, data.project_id)
  return {
    ...data,
    workspace_projects: {
      id: project.id,
      name: project.name,
      color: project.color,
      icon: project.icon,
    },
  } as WorkspaceTask
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
    assigneeId?: string | null
  },
) {
  const userId = await requireUserId()
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
      due_date: input.dueDate ?? null,
      assignee_id: input.assigneeId ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  await recordWsActivity({
    workspaceId,
    eventType: 'task.created',
    summary: `Task “${input.title}” created`,
    entityType: 'task',
    entityId: data.id,
  })
  return getWorkspaceTask(workspaceId, data.id)
}

export async function updateWorkspaceTask(
  workspaceId: string,
  taskId: string,
  patch: Updates<'workspace_tasks'>,
) {
  const next = { ...patch }
  if (patch.status === 'done' && patch.completed_at === undefined) {
    next.completed_at = new Date().toISOString()
  }
  if (patch.status && patch.status !== 'done') {
    next.completed_at = null
  }
  const { error } = await supabase
    .from('workspace_tasks')
    .update(next)
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
  if (error) throw error
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
  const [members, projects, tasks, activity] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    listWorkspaceProjects(workspaceId),
    listWorkspaceTasks(workspaceId),
    listWorkspaceActivity(workspaceId, 8),
  ])
  const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'archived')
  return {
    memberCount: members.length,
    projectCount: projects.length,
    openTaskCount: openTasks.length,
    doneTaskCount: tasks.filter((task) => task.status === 'done').length,
    recentActivity: activity,
    projects: projects.slice(0, 5),
    openTasks: openTasks.slice(0, 6),
  }
}

export function inviteLinkForCode(code: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/workspace?join=${encodeURIComponent(code)}`
}
