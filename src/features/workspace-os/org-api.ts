import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { workspaceKeys } from '@/features/workspace-os/api'
import type { Tables, Updates } from '@/types/database'

export type WorkspaceDepartment = Tables<'workspace_departments'>
export type WorkspaceTeam = Tables<'workspace_teams'>
export type WorkspaceTeamMember = Tables<'workspace_team_members'>

export const orgKeys = {
  all: (workspaceId: string) => [...workspaceKeys.all, 'org', workspaceId] as const,
  departments: (workspaceId: string) => [...orgKeys.all(workspaceId), 'departments'] as const,
  teams: (workspaceId: string) => [...orgKeys.all(workspaceId), 'teams'] as const,
  teamMembers: (workspaceId: string, teamId: string) =>
    [...orgKeys.all(workspaceId), 'team-members', teamId] as const,
}

export async function listDepartments(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_departments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name')
  if (error) throw error
  return (data ?? []) as WorkspaceDepartment[]
}

export async function createDepartment(
  workspaceId: string,
  input: { name: string; description?: string; parentId?: string | null },
) {
  await requireUserId()
  const { data, error } = await supabase
    .from('workspace_departments')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      description: input.description ?? null,
      parent_id: input.parentId ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceDepartment
}

export async function updateDepartment(
  workspaceId: string,
  departmentId: string,
  patch: Pick<Updates<'workspace_departments'>, 'name' | 'description' | 'parent_id'>,
) {
  const { data, error } = await supabase
    .from('workspace_departments')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', departmentId)
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceDepartment
}

export async function deleteDepartment(workspaceId: string, departmentId: string) {
  const { error } = await supabase
    .from('workspace_departments')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', departmentId)
  if (error) throw error
}

export async function listTeams(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_teams')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name')
  if (error) throw error
  return (data ?? []) as WorkspaceTeam[]
}

export async function createTeam(
  workspaceId: string,
  input: {
    name: string
    description?: string
    departmentId?: string | null
    leadUserId?: string | null
  },
) {
  await requireUserId()
  const { data, error } = await supabase
    .from('workspace_teams')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      description: input.description ?? null,
      department_id: input.departmentId ?? null,
      lead_user_id: input.leadUserId ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceTeam
}

export async function updateTeam(
  workspaceId: string,
  teamId: string,
  patch: Pick<
    Updates<'workspace_teams'>,
    'name' | 'description' | 'department_id' | 'lead_user_id'
  >,
) {
  const { data, error } = await supabase
    .from('workspace_teams')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', teamId)
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceTeam
}

export async function deleteTeam(workspaceId: string, teamId: string) {
  const { error: membersError } = await supabase
    .from('workspace_team_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('team_id', teamId)
  if (membersError) throw membersError
  const { error } = await supabase
    .from('workspace_teams')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', teamId)
  if (error) throw error
}

export async function listTeamMembers(workspaceId: string, teamId: string) {
  const { data, error } = await supabase
    .from('workspace_team_members')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('team_id', teamId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as WorkspaceTeamMember[]
}

export async function addTeamMember(workspaceId: string, teamId: string, userId: string) {
  await requireUserId()
  const { data, error } = await supabase
    .from('workspace_team_members')
    .insert({
      workspace_id: workspaceId,
      team_id: teamId,
      user_id: userId,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as WorkspaceTeamMember
}

export async function removeTeamMember(workspaceId: string, teamId: string, userId: string) {
  const { error } = await supabase
    .from('workspace_team_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('team_id', teamId)
    .eq('user_id', userId)
  if (error) throw error
}

export type OrgTreeNode = {
  department: WorkspaceDepartment
  children: OrgTreeNode[]
  teams: WorkspaceTeam[]
}

export function buildOrgTree(
  departments: WorkspaceDepartment[],
  teams: WorkspaceTeam[],
): OrgTreeNode[] {
  const byParent = new Map<string | null, WorkspaceDepartment[]>()
  for (const dept of departments) {
    const key = dept.parent_id
    const list = byParent.get(key) ?? []
    list.push(dept)
    byParent.set(key, list)
  }

  function build(parentId: string | null): OrgTreeNode[] {
    return (byParent.get(parentId) ?? []).map((department) => ({
      department,
      children: build(department.id),
      teams: teams.filter((team) => team.department_id === department.id),
    }))
  }

  const rooted = build(null)
  const unassignedTeams = teams.filter((team) => !team.department_id)
  if (unassignedTeams.length) {
    rooted.push({
      department: {
        id: '__unassigned__',
        workspace_id: departments[0]?.workspace_id ?? teams[0]?.workspace_id ?? '',
        parent_id: null,
        name: '',
        description: null,
        head_user_id: null,
        sort_order: 9999,
        created_at: '',
        updated_at: '',
      },
      children: [],
      teams: unassignedTeams,
    })
  }
  return rooted
}
