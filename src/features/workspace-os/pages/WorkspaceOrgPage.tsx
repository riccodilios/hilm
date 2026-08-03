import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Building2, ChevronRight, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  addTeamMember,
  buildOrgTree,
  createDepartment,
  createTeam,
  deleteDepartment,
  deleteTeam,
  listDepartments,
  listTeamMembers,
  listTeams,
  orgKeys,
  removeTeamMember,
  type OrgTreeNode,
} from '@/features/workspace-os/org-api'
import {
  listWorkspaceMembers,
  workspaceKeys,
  type WorkspaceMember,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { OrgLeadershipHealth } from '@/features/workspace-os/components/OrgLeadershipHealth'
import { DepartmentFilterBar } from '@/features/workspace-os/components/DepartmentFilterBar'
import {
  memberInitials,
  resolveMemberDisplayName,
} from '@/features/workspace-os/lib/member-display'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, Skeleton } from '@/components/ui/page'

function memberLabel(member: WorkspaceMember) {
  return resolveMemberDisplayName({
    displayNameOverride: member.display_name_override,
    displayName: member.profiles?.display_name,
    email: member.email ?? member.profiles?.email,
  })
}

function TeamBlock({
  workspaceId,
  team,
  members,
  canManage,
  memberMap,
}: {
  workspaceId: string
  team: { id: string; name: string; lead_user_id: string | null; description: string | null }
  members: WorkspaceMember[]
  canManage: boolean
  memberMap: Map<string, WorkspaceMember>
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const teamMembers = useQuery({
    queryKey: orgKeys.teamMembers(workspaceId, team.id),
    queryFn: () => listTeamMembers(workspaceId, team.id),
  })

  const addMember = useMutation({
    mutationFn: (userId: string) => addTeamMember(workspaceId, team.id, userId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: orgKeys.teamMembers(workspaceId, team.id) })
      toast.success(t('workspace.orgMemberAdded', { defaultValue: 'Member added to team' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const removeMemberMut = useMutation({
    mutationFn: (userId: string) => removeTeamMember(workspaceId, team.id, userId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: orgKeys.teamMembers(workspaceId, team.id) })
      toast.success(t('workspace.orgMemberRemoved', { defaultValue: 'Member removed' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const lead = team.lead_user_id ? memberMap.get(team.lead_user_id) : null
  const assignedIds = new Set((teamMembers.data ?? []).map((m) => m.user_id))

  return (
    <div className="rounded-xl border border-border-subtle bg-surface/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-3.5 text-muted" />
            {team.name}
          </p>
          {team.description ? (
            <p className="mt-0.5 text-xs text-muted">{team.description}</p>
          ) : null}
          {lead ? (
            <p className="mt-1 text-xs text-muted">
              {t('workspace.orgTeamLead', { defaultValue: 'Lead' })}: {memberLabel(lead)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(teamMembers.data ?? []).map((row) => {
          const member = memberMap.get(row.user_id)
          const name = member ? memberLabel(member) : row.user_id.slice(0, 8)
          return (
            <span
              key={row.id}
              className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-2 px-2 py-1 text-xs"
            >
              {member ? memberInitials(name) : '?'}
              <span>{name}</span>
              {canManage ? (
                <button
                  type="button"
                  className="text-muted hover:text-foreground"
                  onClick={() => removeMemberMut.mutate(row.user_id)}
                >
                  ×
                </button>
              ) : null}
            </span>
          )
        })}
        {teamMembers.isLoading ? (
          <span className="text-xs text-muted">{t('common.loading', { defaultValue: 'Loading…' })}</span>
        ) : null}
      </div>
      {canManage ? (
        <div className="mt-2">
          <select
            className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs"
            defaultValue=""
            onChange={(e) => {
              const userId = e.target.value
              if (userId && !assignedIds.has(userId)) addMember.mutate(userId)
              e.target.value = ''
            }}
            aria-label={t('workspace.orgAddMember', { defaultValue: 'Add member' })}
          >
            <option value="">{t('workspace.orgAddMember', { defaultValue: 'Add member' })}</option>
            {members
              .filter((m) => !assignedIds.has(m.user_id))
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {memberLabel(m)}
                </option>
              ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}

function DepartmentNode({
  node,
  depth,
  workspaceId,
  members,
  canManage,
  memberMap,
  onDeleteDept,
}: {
  node: OrgTreeNode
  depth: number
  workspaceId: string
  members: WorkspaceMember[]
  canManage: boolean
  memberMap: Map<string, WorkspaceMember>
  onDeleteDept: (id: string) => void
}) {
  const { t } = useTranslation()
  const isUnassigned = node.department.id === '__unassigned__'
  const title = isUnassigned
    ? t('workspace.orgUnassignedTeams', { defaultValue: 'Unassigned teams' })
    : node.department.name

  return (
    <div style={{ marginInlineStart: depth * 16 }}>
      <div className="flex items-center gap-2 py-1">
        {depth > 0 ? <ChevronRight className="size-3 text-muted" /> : null}
        <Building2 className="size-3.5 text-muted" />
        <span className="text-sm font-medium">{title}</span>
        {!isUnassigned && node.department.description ? (
          <span className="text-xs text-muted">— {node.department.description}</span>
        ) : null}
        {canManage && !isUnassigned ? (
          <Button size="sm" variant="ghost" onClick={() => onDeleteDept(node.department.id)}>
            {t('common.remove', { defaultValue: 'Remove' })}
          </Button>
        ) : null}
      </div>
      {node.teams.length ? (
        <div className="mb-3 space-y-2 ps-4">
          {node.teams.map((team) => (
            <TeamBlock
              key={team.id}
              workspaceId={workspaceId}
              team={team}
              members={members}
              canManage={canManage}
              memberMap={memberMap}
            />
          ))}
        </div>
      ) : null}
      {node.children.map((child) => (
        <DepartmentNode
          key={child.department.id}
          node={child}
          depth={depth + 1}
          workspaceId={workspaceId}
          members={members}
          canManage={canManage}
          memberMap={memberMap}
          onDeleteDept={onDeleteDept}
        />
      ))}
    </div>
  )
}

export function WorkspaceOrgPage() {
  const { t } = useTranslation()
  const { workspaceId, canManage } = useWorkspace()
  const qc = useQueryClient()
  const [deptName, setDeptName] = useState('')
  const [deptParent, setDeptParent] = useState<string>('')
  const [teamName, setTeamName] = useState('')
  const [teamDept, setTeamDept] = useState<string>('')
  const [teamLead, setTeamLead] = useState<string>('')

  const departments = useQuery({
    queryKey: orgKeys.departments(workspaceId),
    queryFn: () => listDepartments(workspaceId),
  })
  const teams = useQuery({
    queryKey: orgKeys.teams(workspaceId),
    queryFn: () => listTeams(workspaceId),
  })
  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
  })

  const tree = useMemo(() => {
    if (!departments.data || !teams.data) return []
    return buildOrgTree(departments.data, teams.data)
  }, [departments.data, teams.data])

  const memberMap = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.user_id, m])),
    [members.data],
  )

  const invalidateOrg = async () => {
    await qc.invalidateQueries({ queryKey: orgKeys.departments(workspaceId) })
    await qc.invalidateQueries({ queryKey: orgKeys.teams(workspaceId) })
  }

  const createDept = useMutation({
    mutationFn: () =>
      createDepartment(workspaceId, {
        name: deptName.trim(),
        parentId: deptParent || null,
      }),
    onSuccess: async () => {
      setDeptName('')
      await invalidateOrg()
      toast.success(t('workspace.orgDeptCreated', { defaultValue: 'Department created' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const createTeamMut = useMutation({
    mutationFn: () =>
      createTeam(workspaceId, {
        name: teamName.trim(),
        departmentId: teamDept || null,
        leadUserId: teamLead || null,
      }),
    onSuccess: async () => {
      setTeamName('')
      setTeamLead('')
      await invalidateOrg()
      toast.success(t('workspace.orgTeamCreated', { defaultValue: 'Team created' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const deleteDept = useMutation({
    mutationFn: (id: string) => deleteDepartment(workspaceId, id),
    onSuccess: invalidateOrg,
    onError: (error: Error) => toast.error(error.message),
  })

  const deleteTeamMut = useMutation({
    mutationFn: (id: string) => deleteTeam(workspaceId, id),
    onSuccess: invalidateOrg,
    onError: (error: Error) => toast.error(error.message),
  })

  const loading = departments.isLoading || teams.isLoading

  return (
    <div>
      <PageHeader
        title={t('workspace.orgTitle', { defaultValue: 'Organization' })}
        description={t('workspace.orgDesc', {
          defaultValue: 'Departments, teams, and reporting structure.',
        })}
      />

      <DepartmentFilterBar className="mb-4" />
      <OrgLeadershipHealth />

      {canManage ? (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('workspace.orgNewDept', { defaultValue: 'New department' })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <input
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                placeholder={t('workspace.name')}
                value={deptName}
                onChange={(e) => setDeptName(e.target.value)}
              />
              <select
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                value={deptParent}
                onChange={(e) => setDeptParent(e.target.value)}
              >
                <option value="">{t('workspace.orgRootDept', { defaultValue: 'Top level' })}</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!deptName.trim() || createDept.isPending}
                onClick={() => createDept.mutate()}
              >
                <Plus className="size-4" /> {t('common.create', { defaultValue: 'Create' })}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('workspace.orgNewTeam', { defaultValue: 'New team' })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <input
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                placeholder={t('workspace.orgTeamName', { defaultValue: 'Team name' })}
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
              <select
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                value={teamDept}
                onChange={(e) => setTeamDept(e.target.value)}
              >
                <option value="">{t('workspace.orgNoDept', { defaultValue: 'No department' })}</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                value={teamLead}
                onChange={(e) => setTeamLead(e.target.value)}
              >
                <option value="">{t('workspace.orgNoLead', { defaultValue: 'No lead' })}</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {memberLabel(m)}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!teamName.trim() || createTeamMut.isPending}
                onClick={() => createTeamMut.mutate()}
              >
                <Plus className="size-4" /> {t('common.create', { defaultValue: 'Create' })}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : tree.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('workspace.orgHierarchy', { defaultValue: 'Hierarchy' })}</CardTitle>
          </CardHeader>
          <CardContent>
            {tree.map((node) => (
              <DepartmentNode
                key={node.department.id}
                node={node}
                depth={0}
                workspaceId={workspaceId}
                members={members.data ?? []}
                canManage={canManage}
                memberMap={memberMap}
                onDeleteDept={(id) => deleteDept.mutate(id)}
              />
            ))}
            {canManage && (teams.data ?? []).length ? (
              <div className="mt-4 border-t border-border-subtle pt-4">
                <p className="mb-2 text-xs text-muted">
                  {t('workspace.orgManageTeams', { defaultValue: 'Remove teams' })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(teams.data ?? []).map((team) => (
                    <Button
                      key={team.id}
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteTeamMut.mutate(team.id)}
                    >
                      {team.name} ×
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted">
          {t('workspace.orgEmpty', { defaultValue: 'No departments or teams yet.' })}
        </p>
      )}
    </div>
  )
}
