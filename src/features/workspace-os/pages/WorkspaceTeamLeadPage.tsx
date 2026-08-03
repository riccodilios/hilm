import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  listWorkspaceTasks,
  updateWorkspaceTask,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { listTeams, orgKeys } from '@/features/workspace-os/org-api'
import {
  TaskAssignmentFields,
  type TaskAssignmentValue,
} from '@/features/workspace-os/components/TaskAssignmentFields'
import { TaskAssigneeLabel } from '@/features/workspace-os/components/TaskAssigneeLabel'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { Button } from '@/components/ui/button'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { PriorityBadge, StatusBadge } from '@/components/ui/badge'

export function WorkspaceTeamLeadPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { workspaceId, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const [distributingId, setDistributingId] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<TaskAssignmentValue>({
    departmentId: null,
    teamId: null,
    assigneeId: null,
  })

  const teams = useQuery({
    queryKey: orgKeys.teams(workspaceId),
    queryFn: () => listTeams(workspaceId),
  })
  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
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

  const distribute = useMutation({
    mutationFn: ({
      taskId,
      assigneeId,
      departmentId,
      teamId,
    }: {
      taskId: string
      assigneeId: string
      departmentId: string | null
      teamId: string | null
    }) =>
      updateWorkspaceTask(workspaceId, taskId, {
        assignee_id: assigneeId,
        department_id: departmentId,
        team_id: teamId,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      setDistributingId(null)
      setAssignment({ departmentId: null, teamId: null, assigneeId: null })
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
        <h2 className="mb-3 text-sm font-medium">{t('workspace.distributionInbox')}</h2>
        <div className="space-y-3">
          {inbox.map((task) => (
            <div key={task.id} className="rounded-xl border border-border-subtle bg-surface/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/workspace/${workspaceId}/tasks/${task.id}`}
                    className="font-medium hover:underline"
                  >
                    {task.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={task.priority} />
                    <StatusBadge status={task.status} />
                    <TaskAssigneeLabel assignee={task.assignee} />
                  </div>
                </div>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant={distributingId === task.id ? 'secondary' : 'default'}
                    onClick={() => {
                      if (distributingId === task.id) {
                        setDistributingId(null)
                        return
                      }
                      setDistributingId(task.id)
                      setAssignment({
                        departmentId: task.department_id ?? leadTeams[0]?.department_id ?? null,
                        teamId: task.team_id ?? leadTeams[0]?.id ?? null,
                        assigneeId: null,
                      })
                    }}
                  >
                    {distributingId === task.id
                      ? t('common.cancel')
                      : t('workspace.assignManually')}
                  </Button>
                ) : null}
              </div>

              {distributingId === task.id ? (
                <div className="mt-4 space-y-3">
                  <TaskAssignmentFields
                    workspaceId={workspaceId}
                    value={assignment}
                    onChange={setAssignment}
                    priority={task.priority}
                    titleHint={task.title}
                    dueAt={task.due_at}
                    estimatedHours={task.estimated_hours}
                  />
                  <Button
                    disabled={!assignment.assigneeId || distribute.isPending}
                    onClick={() => {
                      if (!assignment.assigneeId) return
                      distribute.mutate({
                        taskId: task.id,
                        assigneeId: assignment.assigneeId,
                        departmentId: assignment.departmentId,
                        teamId: assignment.teamId,
                      })
                    }}
                  >
                    {t('workspace.confirmAssignment')}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
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
