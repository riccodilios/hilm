import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import {
  listAllMemberSettings,
  listWorkspaceMembers,
  listWorkspaceTasks,
  workspaceKeys,
  type WorkspaceMember,
} from '@/features/workspace-os/api'
import {
  listDepartments,
  listTeamMembers,
  listTeams,
  orgKeys,
} from '@/features/workspace-os/org-api'
import {
  analyzeAssignmentCandidates,
  type AssigneeRecommendation,
  type MemberLoadProfile,
} from '@/features/workspace-os/load-balancer'
import {
  memberInitials,
  resolveMemberDisplayName,
} from '@/features/workspace-os/lib/member-display'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export type TaskAssignmentValue = {
  departmentId: string | null
  teamId: string | null
  assigneeId: string | null
}

function labelFor(member: WorkspaceMember) {
  return resolveMemberDisplayName({
    displayNameOverride: member.display_name_override,
    displayName: member.profiles?.display_name,
    email: member.email ?? member.profiles?.email,
  })
}

function CapacityBar({ percent, capacity }: { percent: number; capacity: MemberLoadProfile['capacity'] }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div
        className={cn(
          'h-full rounded-full transition-all',
          capacity === 'low' && 'bg-success',
          capacity === 'medium' && 'bg-info',
          capacity === 'high' && 'bg-warning',
          capacity === 'overloaded' && 'bg-danger',
        )}
        style={{ width: `${Math.min(100, Math.max(4, percent))}%` }}
      />
    </div>
  )
}

function MemberAvatar({ member, name }: { member: WorkspaceMember; name: string }) {
  const url = member.profiles?.avatar_url
  if (url) {
    return <img src={url} alt="" className="size-8 shrink-0 rounded-lg object-cover" />
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-[10px] font-medium text-accent">
      {memberInitials(name)}
    </span>
  )
}

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
  /** When false, only dept/team/member selectors (still fully usable). */
  showAiAssist?: boolean
}) {
  const { t } = useTranslation()
  const [manualMode, setManualMode] = useState(false)

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

  const teamsInDept = useMemo(
    () =>
      (teams.data ?? []).filter((team) =>
        value.departmentId ? team.department_id === value.departmentId : true,
      ),
    [teams.data, value.departmentId],
  )

  const memberOptions = useMemo(() => {
    const all = members.data ?? []
    if (value.teamId && teamMembers.data?.length) {
      const ids = new Set(teamMembers.data.map((m) => m.user_id))
      return all.filter((m) => ids.has(m.user_id))
    }
    return all
  }, [members.data, value.teamId, teamMembers.data])

  const insight = useMemo(() => {
    if (!showAiAssist || !members.data?.length || !tasks.data) {
      return null
    }
    // Wait until department + team chosen for focused analysis (still works with all members).
    if (!value.departmentId && !value.teamId && memberOptions.length > 12) {
      return null
    }
    const settingsByUser = new Map(
      (allSettings.data ?? []).map((row) => [
        row.user_id,
        {
          skills: row.skills,
          availability: (row.availability ?? {}) as Record<string, unknown>,
        },
      ]),
    )
    try {
      return analyzeAssignmentCandidates({
        members: members.data,
        tasks: tasks.data,
        candidateIds: memberOptions.map((m) => m.user_id),
        settingsByUser,
        priority,
        estimatedHours,
        dueAt,
        titleHint,
      })
    } catch {
      return null
    }
  }, [
    showAiAssist,
    members.data,
    tasks.data,
    allSettings.data,
    memberOptions,
    value.departmentId,
    value.teamId,
    priority,
    estimatedHours,
    dueAt,
    titleHint,
  ])

  const profileByUser = useMemo(() => {
    return new Map((insight?.profiles ?? []).map((p) => [p.userId, p]))
  }, [insight?.profiles])

  const memberById = useMemo(() => {
    return new Map((members.data ?? []).map((m) => [m.user_id, m]))
  }, [members.data])

  function pickAssignee(userId: string, fromAi: boolean) {
    onChange({ ...value, assigneeId: userId })
    setManualMode(!fromAi)
  }

  function renderRecommendation(rec: AssigneeRecommendation, emphasized: boolean) {
    const member = memberById.get(rec.userId)
    if (!member) return null
    const name = labelFor(member)
    const profile = profileByUser.get(rec.userId)
    return (
      <div
        key={rec.userId}
        className={cn(
          'rounded-xl border p-3',
          emphasized ? 'border-accent/30 bg-accent/5' : 'border-border-subtle bg-surface/40',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <MemberAvatar member={member} name={name} />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                {emphasized ? <Sparkles className="size-3.5 shrink-0 text-accent" /> : null}
                {emphasized ? `${t('workspace.recommendedAssignee')}: ${name}` : name}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                {t('workspace.confidenceScore', { score: rec.confidence })}
                {' · '}
                {t('workspace.completionConfidence', { score: rec.expectedCompletionConfidence })}
                {' · '}
                {t('workspace.workloadImpact', { hours: rec.workloadImpactHours })}
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {rec.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
              {profile ? (
                <div className="mt-2 w-40">
                  <CapacityBar percent={profile.loadPercent} capacity={profile.capacity} />
                </div>
              ) : null}
            </div>
          </div>
          <Button type="button" size="sm" variant={emphasized ? 'default' : 'secondary'} onClick={() => pickAssignee(rec.userId, true)}>
            {emphasized ? t('workspace.assignRecommended') : t('workspace.assignThis')}
          </Button>
        </div>
      </div>
    )
  }

  const showAssistPanel =
    showAiAssist && Boolean(insight?.best) && Boolean(value.departmentId || value.teamId || memberOptions.length <= 12)

  return (
    <div className={cn('space-y-3 rounded-xl border border-border-subtle bg-surface-2/30 p-3', className)}>
      <p className="text-sm font-medium">{t('workspace.assignTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="assign-dept">{t('workspace.department')}</Label>
          <select
            id="assign-dept"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
            value={value.departmentId ?? ''}
            onChange={(e) => {
              onChange({
                departmentId: e.target.value || null,
                teamId: null,
                assigneeId: null,
              })
              setManualMode(false)
            }}
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
                assigneeId: null,
              })
              setManualMode(false)
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

      {showAiAssist && insight?.profiles.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">{t('workspace.teamLoadTitle')}</p>
          <div className="max-h-48 space-y-2 overflow-y-auto pe-1">
            {insight.profiles.map((profile) => {
              const member = memberById.get(profile.userId)
              if (!member) return null
              const name = labelFor(member)
              const selected = value.assigneeId === profile.userId
              return (
                <button
                  key={profile.userId}
                  type="button"
                  onClick={() => pickAssignee(profile.userId, false)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-start transition-colors',
                    selected
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-border-subtle bg-surface/50 hover:border-border',
                  )}
                >
                  <MemberAvatar member={member} name={name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <span
                        className={cn(
                          'shrink-0 rounded-md px-1.5 py-0.5 text-[10px]',
                          profile.capacity === 'low' && 'bg-success/15 text-success',
                          profile.capacity === 'medium' && 'bg-info/15 text-info',
                          profile.capacity === 'high' && 'bg-warning/15 text-warning',
                          profile.capacity === 'overloaded' && 'bg-danger/15 text-danger',
                        )}
                      >
                        {t(`workspace.capacity.${profile.capacity}`)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {t(`workspace.roles.${profile.role}`, { defaultValue: profile.role })}
                      {' · '}
                      {t('workspace.loadActive', { count: profile.openCount })}
                      {' · '}
                      {t('workspace.loadOverdue', { count: profile.overdueCount })}
                      {' · '}
                      {profile.available ? t('workspace.available') : t('workspace.unavailable')}
                    </p>
                    <div className="mt-1.5">
                      <CapacityBar percent={profile.loadPercent} capacity={profile.capacity} />
                      <p className="mt-0.5 text-[10px] text-muted">
                        {t('workspace.loadHours', {
                          used: Math.round(profile.estimatedHoursLoad),
                          total: Math.round(profile.availableHoursWeek),
                        })}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {showAssistPanel && insight?.best ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted">{t('workspace.aiAssignAssist')}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setManualMode(true)}>
              {t('workspace.assignManually')}
            </Button>
          </div>
          {renderRecommendation(insight.best, true)}
          {insight.alternatives.length ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted">{t('workspace.alternativeCandidates')}</p>
              {insight.alternatives.map((rec) => renderRecommendation(rec, false))}
            </div>
          ) : null}
          {!manualMode && value.assigneeId === insight.best.userId ? (
            <p className="text-[11px] text-muted">{t('workspace.usingRecommendation')}</p>
          ) : null}
        </div>
      ) : null}

      {(manualMode || !showAssistPanel || !insight?.best) && (
        <div className="space-y-1.5">
          <Label htmlFor="assign-member">{t('workspace.memberOptional')}</Label>
          <select
            id="assign-member"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
            value={value.assigneeId ?? ''}
            onChange={(e) => {
              onChange({ ...value, assigneeId: e.target.value || null })
              setManualMode(true)
            }}
          >
            <option value="">{t('workspace.unassignedMember')}</option>
            {memberOptions.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {labelFor(m)}
              </option>
            ))}
          </select>
        </div>
      )}

      {!value.assigneeId && (value.teamId || value.departmentId) ? (
        <p className="text-xs text-muted">{t('workspace.teamLeadDeliveryHint')}</p>
      ) : null}
    </div>
  )
}
