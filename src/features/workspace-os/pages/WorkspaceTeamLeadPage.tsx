import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  listAllMemberSettings,
  listWorkspaceMembers,
  listWorkspaceTasks,
  updateWorkspaceTask,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { listTeams, orgKeys } from '@/features/workspace-os/org-api'
import {
  buildMemberCapacities,
  recommendAssignee,
} from '@/features/workspace-os/load-balancer'
import { resolveMemberDisplayName } from '@/features/workspace-os/lib/member-display'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { Button } from '@/components/ui/button'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { PriorityBadge, StatusBadge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function WorkspaceTeamLeadPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { workspaceId, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const [distributingId, setDistributingId] = useState<string | null>(null)
  const [selectedMember, setSelectedMember] = useState('')

  const teams = useQuery({
    queryKey: orgKeys.teams(workspaceId),
    queryFn: () => listTeams(workspaceId),
  })
  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
  })
  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
  })
  const settings = useQuery({
    queryKey: [...workspaceKeys.all, 'member-settings-all', workspaceId],
    queryFn: () => listAllMemberSettings(workspaceId),
  })

  const leadTeams = useMemo(
    () => (teams.data ?? []).filter((team) => team.lead_user_id === user?.id),
    [teams.data, user?.id],
  )

  const leadTeamIds = useMemo(() => new Set(leadTeams.map((t) => t.id)), [leadTeams])
  const leadDeptIds = useMemo(
    () => new Set(leadTeams.map((t) => t.department_id).filter(Boolean) as string[]),
    [leadTeams],
  )

  const inbox = useMemo(() => {
    return (tasks.data ?? []).filter((task) => {
      if (task.status === 'done' || task.status === 'archived') return false
      if (task.team_id && leadTeamIds.has(task.team_id)) return true
      if (task.department_id && leadDeptIds.has(task.department_id) && !task.team_id) return true
      if (task.assignee_id === user?.id && (task.team_id || task.department_id)) return true
      return false
    })
  }, [tasks.data, leadTeamIds, leadDeptIds, user?.id])

  const settingsByUser = useMemo(() => {
    return new Map(
      (settings.data ?? []).map((row) => [
        row.user_id,
        {
          skills: row.skills,
          availability: (row.availability ?? {}) as Record<string, unknown>,
        },
      ]),
    )
  }, [settings.data])

  const capacities = useMemo(() => {
    if (!members.data || !tasks.data) return []
    return buildMemberCapacities(members.data, tasks.data, settingsByUser)
  }, [members.data, tasks.data, settingsByUser])

  const distribute = useMutation({
    mutationFn: ({ taskId, assigneeId }: { taskId: string; assigneeId: string }) =>
      updateWorkspaceTask(workspaceId, taskId, { assignee_id: assigneeId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      setDistributingId(null)
      setSelectedMember('')
      toast.success(t('workspace.taskDistributed'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (teams.isLoading || tasks.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  if (!leadTeams.length) {
    return (
      <div>
        <PageHeader title={t('workspace.teamLeadTitle')} description={t('workspace.teamLeadDesc')} />
        <div className="mt-6 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted">{t('workspace.notTeamLead')}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={t('workspace.teamLeadTitle')} description={t('workspace.teamLeadDesc')} />

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium">{t('workspace.teamCapacity')}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {capacities.map((cap) => {
            const member = (members.data ?? []).find((m) => m.user_id === cap.userId)
            if (!member) return null
            const name = resolveMemberDisplayName({
              displayNameOverride: member.display_name_override,
              displayName: member.profiles?.display_name,
              email: member.email ?? member.profiles?.email,
            })
            return (
              <div
                key={cap.userId}
                className="rounded-xl border border-border-subtle bg-surface/50 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{name}</p>
                  <span
                    className={cn(
                      'rounded-md px-2 py-0.5 text-[11px]',
                      cap.capacity === 'low' && 'bg-success/15 text-success',
                      cap.capacity === 'medium' && 'bg-info/15 text-info',
                      cap.capacity === 'high' && 'bg-warning/15 text-warning',
                      cap.capacity === 'overloaded' && 'bg-danger/15 text-danger',
                    )}
                  >
                    {t(`workspace.capacity.${cap.capacity}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t('workspace.workloadSummary', {
                    open: cap.openCount,
                    deadlines: cap.upcomingDeadlines,
                    available: cap.available
                      ? t('workspace.available')
                      : t('workspace.unavailable'),
                  })}
                </p>
                {cap.skills.length ? (
                  <p className="mt-1 text-[11px] text-muted">{cap.skills.slice(0, 4).join(' · ')}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium">{t('workspace.distributionInbox')}</h2>
        <div className="space-y-2">
          {inbox.map((task) => {
            const suggestion =
              members.data && tasks.data
                ? recommendAssignee({
                    members: members.data,
                    tasks: tasks.data,
                    priority: task.priority,
                    dueAt: task.due_at,
                    estimatedHours: task.estimated_hours,
                    titleHint: task.title,
                    settingsByUser,
                    candidateIds: members.data.map((m) => m.user_id),
                  })
                : null
            const suggestedName = suggestion
              ? resolveMemberDisplayName({
                  displayNameOverride: (members.data ?? []).find((m) => m.user_id === suggestion.userId)
                    ?.display_name_override,
                  displayName: (members.data ?? []).find((m) => m.user_id === suggestion.userId)
                    ?.profiles?.display_name,
                  email:
                    (members.data ?? []).find((m) => m.user_id === suggestion.userId)?.email ??
                    (members.data ?? []).find((m) => m.user_id === suggestion.userId)?.profiles?.email,
                })
              : null

            return (
              <div
                key={task.id}
                className="rounded-xl border border-border-subtle bg-surface/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/workspace/${workspaceId}/tasks/${task.id}`}
                      className="font-medium hover:underline"
                    >
                      {task.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <PriorityBadge priority={task.priority} />
                      <StatusBadge status={task.status} />
                    </div>
                    {suggestion && suggestedName ? (
                      <p className="mt-2 text-xs text-muted">
                        {t('workspace.recommendedAssignee')}: {suggestedName} (
                        {suggestion.confidence}%)
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {suggestion ? (
                        <Button
                          size="sm"
                          disabled={distribute.isPending}
                          onClick={() =>
                            distribute.mutate({
                              taskId: task.id,
                              assigneeId: suggestion.userId,
                            })
                          }
                        >
                          {t('workspace.assignRecommended')}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setDistributingId(task.id)
                          setSelectedMember(suggestion?.userId ?? '')
                        }}
                      >
                        {t('workspace.assignManually')}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {distributingId === task.id ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <select
                      className="h-9 min-w-[180px] rounded-lg border border-border bg-surface px-2 text-sm"
                      value={selectedMember}
                      onChange={(e) => setSelectedMember(e.target.value)}
                    >
                      <option value="">{t('workspace.selectMember')}</option>
                      {(members.data ?? []).map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {resolveMemberDisplayName({
                            displayNameOverride: m.display_name_override,
                            displayName: m.profiles?.display_name,
                            email: m.email ?? m.profiles?.email,
                          })}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!selectedMember || distribute.isPending}
                      onClick={() =>
                        distribute.mutate({ taskId: task.id, assigneeId: selectedMember })
                      }
                    >
                      {t('common.save')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}
          {!inbox.length ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted">
              {t('workspace.noLeadTasks')}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
