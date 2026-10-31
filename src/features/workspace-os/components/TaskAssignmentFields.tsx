import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, Search, Sparkles } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  listAllMemberSettings,
  listWorkspaceMembers,
  listWorkspaceTasks,
  workspaceKeys,
  type WorkspaceMember,
} from '@/features/workspace-os/api'
import {
  listAllTeamMembers,
  listDepartments,
  listTeamMembers,
  listTeams,
  orgKeys,
} from '@/features/workspace-os/org-api'
import { resolveMemberDepartments } from '@/features/workspace-os/lib/member-visibility'
import { analyzeAssignmentCandidates } from '@/features/workspace-os/load-balancer'
import {
  memberInitials,
  resolveMemberDisplayName,
} from '@/features/workspace-os/lib/member-display'
import { memberPosition } from '@/features/workspace-os/lib/member-positions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export type TaskAssignmentValue = {
  departmentId: string | null
  teamId: string | null
  assigneeId: string | null
}

const SEARCH_THRESHOLD = 6

function labelFor(member: WorkspaceMember) {
  return resolveMemberDisplayName({
    displayNameOverride: member.display_name_override,
    displayName: member.profiles?.display_name,
    email: member.email ?? member.profiles?.email,
  })
}

function MemberAvatar({ member, name }: { member: WorkspaceMember; name: string }) {
  const url = member.profiles?.avatar_url
  if (url) {
    return <img src={url} alt="" className="size-7 shrink-0 rounded-lg object-cover" />
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-[10px] font-medium text-accent">
      {memberInitials(name)}
    </span>
  )
}

/** Pick who does the task: anyone in the workspace (owners, admins and yourself included), with an AI suggestion. */
export function TaskAssignmentFields({
  workspaceId,
  value,
  onChange,
  priority = 'none',
  titleHint = '',
  dueAt = null,
  estimatedHours = null,
  className,
  showAiAssist = true,
}: {
  workspaceId: string
  value: TaskAssignmentValue
  onChange: (next: TaskAssignmentValue) => void
  priority?: string
  titleHint?: string
  dueAt?: string | null
  estimatedHours?: number | null
  className?: string
  showAiAssist?: boolean
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [routingOpen, setRoutingOpen] = useState(Boolean(value.departmentId || value.teamId))

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
  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
    enabled: showAiAssist,
  })
  const allSettings = useQuery({
    queryKey: [...workspaceKeys.all, 'member-settings-all', workspaceId],
    queryFn: () => listAllMemberSettings(workspaceId),
  })
  const teamMembers = useQuery({
    queryKey: orgKeys.teamMembers(workspaceId, value.teamId ?? ''),
    queryFn: () => listTeamMembers(workspaceId, value.teamId!),
    enabled: Boolean(value.teamId),
  })

  const hasOrg = Boolean(departments.data?.length || teams.data?.length)
  const teamsInDept = useMemo(
    () =>
      (teams.data ?? []).filter((team) =>
        value.departmentId ? team.department_id === value.departmentId : true,
      ),
    [teams.data, value.departmentId],
  )

  const allTeamMembers = useQuery({
    queryKey: orgKeys.allTeamMembers(workspaceId),
    queryFn: () => listAllTeamMembers(workspaceId),
  })
  const homeDepartmentByUser = useMemo(
    () =>
      resolveMemberDepartments({
        departments: departments.data ?? [],
        teams: teams.data ?? [],
        teamMembers: allTeamMembers.data ?? [],
        memberSettings: allSettings.data ?? [],
      }),
    [departments.data, teams.data, allTeamMembers.data, allSettings.data],
  )

  const people = useMemo(() => {
    const list = (members.data ?? []).map((member) => ({
      member,
      name: labelFor(member),
      position: memberPosition(
        {
          userId: member.user_id,
          role: member.role,
          departments: departments.data ?? [],
          teams: teams.data ?? [],
          homeDepartmentId: homeDepartmentByUser.get(member.user_id) ?? null,
        },
        t,
      ),
      isYou: member.user_id === user?.id,
    }))
    return list.sort((a, b) => Number(b.isYou) - Number(a.isYou) || a.name.localeCompare(b.name))
  }, [members.data, departments.data, teams.data, homeDepartmentByUser, user?.id, t])

  const personById = useMemo(() => new Map(people.map((p) => [p.member.user_id, p])), [people])

  // The suggestion looks at the chosen team (or department) first, else the whole workspace.
  const candidateIds = useMemo(() => {
    if (value.teamId && teamMembers.data?.length) return teamMembers.data.map((row) => row.user_id)
    if (value.departmentId) {
      const inDept = people
        .filter((p) => homeDepartmentByUser.get(p.member.user_id) === value.departmentId)
        .map((p) => p.member.user_id)
      if (inDept.length) return inDept
    }
    return null
  }, [value.teamId, value.departmentId, teamMembers.data, people, homeDepartmentByUser])

  const insight = useMemo(() => {
    if (!showAiAssist || !members.data?.length || !tasks.data) return null
    const settingsByUser = new Map(
      (allSettings.data ?? []).map((row) => [
        row.user_id,
        { skills: row.skills, availability: (row.availability ?? {}) as Record<string, unknown> },
      ]),
    )
    try {
      return analyzeAssignmentCandidates({
        members: members.data,
        tasks: tasks.data,
        candidateIds,
        settingsByUser,
        priority,
        estimatedHours,
        dueAt,
        titleHint,
      })
    } catch {
      return null
    }
  }, [showAiAssist, members.data, tasks.data, allSettings.data, candidateIds, priority, estimatedHours, dueAt, titleHint])

  const openCountByUser = useMemo(
    () => new Map((insight?.profiles ?? []).map((profile) => [profile.userId, profile.openCount])),
    [insight?.profiles],
  )

  const suggestion = insight?.best ? personById.get(insight.best.userId) : null
  const showSuggestion = Boolean(suggestion && insight?.best && value.assigneeId !== insight.best.userId)

  const query = search.trim().toLowerCase()
  const visiblePeople = query
    ? people.filter((p) =>
        [p.name, p.position, p.member.email ?? ''].some((text) => text.toLowerCase().includes(query)),
      )
    : people

  function assign(userId: string | null) {
    onChange({ ...value, assigneeId: userId })
  }

  return (
    <div className={cn('space-y-3 rounded-xl border border-border-subtle bg-surface-2/30 p-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('workspace.assignTitle')}</p>
        {hasOrg ? (
          <button
            type="button"
            className="text-xs text-muted transition-colors hover:text-foreground"
            onClick={() => setRoutingOpen((open) => !open)}
          >
            {routingOpen ? t('workspace.hideRouting') : t('workspace.routeToTeam')}
          </button>
        ) : null}
      </div>

      {routingOpen && hasOrg ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="assign-dept">{t('workspace.department')}</Label>
            <select
              id="assign-dept"
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              value={value.departmentId ?? ''}
              onChange={(e) =>
                onChange({ departmentId: e.target.value || null, teamId: null, assigneeId: value.assigneeId })
              }
            >
              <option value="">{t('workspace.anyDepartment')}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assign-team">{t('workspace.team')}</Label>
            <select
              id="assign-team"
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              value={value.teamId ?? ''}
              onChange={(e) => {
                const teamId = e.target.value || null
                const team = (teams.data ?? []).find((item) => item.id === teamId)
                onChange({
                  departmentId: value.departmentId ?? team?.department_id ?? null,
                  teamId,
                  assigneeId: value.assigneeId,
                })
              }}
            >
              <option value="">{t('workspace.anyTeam')}</option>
              {teamsInDept.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {showSuggestion && suggestion && insight?.best ? (
        <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
          <Sparkles className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              <span className="text-muted">{t('workspace.suggestedAssignee')}: </span>
              <span className="font-medium">{suggestion.name}</span>{' '}
              <span className="text-[11px] text-muted">{suggestion.position}</span>
            </p>
            {insight.best.reasons.length ? (
              <p className="truncate text-[11px] text-muted">{insight.best.reasons.slice(0, 2).join(' · ')}</p>
            ) : null}
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => assign(insight.best!.userId)}>
            {t('workspace.assignThis')}
          </Button>
        </div>
      ) : null}

      {people.length > SEARCH_THRESHOLD ? (
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('workspace.searchPeople')}
            aria-label={t('workspace.searchPeople')}
            className="h-9 ps-9 text-sm"
          />
        </div>
      ) : null}

      <div role="radiogroup" aria-label={t('workspace.assignTitle')} className="max-h-64 space-y-1 overflow-y-auto pe-1">
        <PersonOption
          selected={!value.assigneeId}
          onSelect={() => assign(null)}
          label={value.teamId || value.departmentId ? t('workspace.unassignedMember') : t('workspace.unassigned')}
        />
        {visiblePeople.map((person) => {
          const open = openCountByUser.get(person.member.user_id)
          return (
            <PersonOption
              key={person.member.user_id}
              selected={value.assigneeId === person.member.user_id}
              onSelect={() => assign(person.member.user_id)}
              avatar={<MemberAvatar member={person.member} name={person.name} />}
              label={person.isYou ? `${person.name} (${t('workspace.you')})` : person.name}
              position={person.position}
              meta={open != null ? t('workspace.openTasksShort', { count: open }) : undefined}
            />
          )
        })}
      </div>

      {!value.assigneeId && (value.teamId || value.departmentId) ? (
        <p className="text-xs text-muted">{t('workspace.teamLeadDeliveryHint')}</p>
      ) : null}
    </div>
  )
}

function PersonOption({
  selected,
  onSelect,
  avatar,
  label,
  position,
  meta,
}: {
  selected: boolean
  onSelect: () => void
  avatar?: ReactNode
  label: string
  position?: string
  meta?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-start transition-colors',
        selected ? 'border-accent/40 bg-accent/10' : 'border-transparent hover:bg-surface',
      )}
    >
      {avatar ?? <span className="size-7 shrink-0 rounded-lg border border-dashed border-border" />}
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{label}</span>
        {position ? <span className="ms-2 text-[11px] text-muted">{position}</span> : null}
      </span>
      {meta ? <span className="shrink-0 text-[11px] tabular-nums text-muted">{meta}</span> : null}
      {selected ? <Check className="size-4 shrink-0 text-accent" /> : null}
    </button>
  )
}
