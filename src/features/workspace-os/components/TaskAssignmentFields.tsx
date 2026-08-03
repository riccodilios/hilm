import { useEffect, useMemo, useState } from 'react'
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
import { recommendAssignee, type AssigneeRecommendation } from '@/features/workspace-os/load-balancer'
import { resolveMemberDisplayName } from '@/features/workspace-os/lib/member-display'
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

export function TaskAssignmentFields({
  workspaceId,
  value,
  onChange,
  priority = 'none',
  titleHint = '',
  dueAt = null,
  estimatedHours = null,
  className,
}: {
  workspaceId: string
  value: TaskAssignmentValue
  onChange: (next: TaskAssignmentValue) => void
  priority?: string
  titleHint?: string
  dueAt?: string | null
  estimatedHours?: number | null
  className?: string
}) {
  const { t } = useTranslation()
  const [manualMode, setManualMode] = useState(true)
  const [recommendation, setRecommendation] = useState<AssigneeRecommendation | null>(null)

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

  const candidateIds = useMemo(() => memberOptions.map((m) => m.user_id), [memberOptions])

  const candidateKey = candidateIds.join(',')

  useEffect(() => {
    if (!members.data?.length || !tasks.data) {
      setRecommendation(null)
      return
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
    const next = recommendAssignee({
      members: members.data,
      tasks: tasks.data,
      priority: priority as never,
      estimatedHours,
      dueAt,
      candidateIds: candidateKey ? candidateKey.split(',') : [],
      settingsByUser,
      titleHint,
    })
    setRecommendation(next)
  }, [
    members.data,
    tasks.data,
    allSettings.data,
    candidateKey,
    priority,
    estimatedHours,
    dueAt,
    titleHint,
  ])

  const recommendedMember = recommendation
    ? (members.data ?? []).find((m) => m.user_id === recommendation.userId)
    : null

  return (
    <div className={cn('space-y-3 rounded-xl border border-border-subtle bg-surface-2/30 p-3', className)}>
      <p className="text-sm font-medium">{t('workspace.assignTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="assign-dept">{t('workspace.department')}</Label>
          <select
            id="assign-dept"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
            value={value.departmentId ?? ''}
            onChange={(e) => {
              const departmentId = e.target.value || null
              onChange({
                departmentId,
                teamId: null,
                assigneeId: null,
              })
              setManualMode(true)
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
              setManualMode(true)
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
      </div>

      {recommendation && recommendedMember ? (
        <div className="rounded-xl border border-accent/25 bg-accent/5 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-3.5 text-accent" />
                {t('workspace.recommendedAssignee')}: {labelFor(recommendedMember)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t('workspace.confidenceScore', { score: recommendation.confidence })}
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {recommendation.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onChange({ ...value, assigneeId: recommendation.userId })
                  setManualMode(false)
                }}
              >
                {t('workspace.assignRecommended')}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setManualMode(true)}>
                {t('workspace.assignManually')}
              </Button>
            </div>
          </div>
          {!manualMode && value.assigneeId === recommendation.userId ? (
            <p className="mt-2 text-[11px] text-muted">{t('workspace.usingRecommendation')}</p>
          ) : null}
        </div>
      ) : null}

      {!value.assigneeId && (value.teamId || value.departmentId) ? (
        <p className="text-xs text-muted">{t('workspace.teamLeadDeliveryHint')}</p>
      ) : null}
    </div>
  )
}
