import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Scale, Sparkles, Zap } from 'lucide-react'
import { toast } from 'sonner'
import {
  getUnassignedOpenTasks,
  listLoadBalanceRuns,
  loadBalancerKeys,
  runLoadBalance,
  scoreMemberWorkloads,
  suggestAssignees,
} from '@/features/workspace-os/load-balancer'
import {
  listWorkspaceMembers,
  listWorkspaceTasks,
  workspaceKeys,
  type WorkspaceMember,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import {
  memberInitials,
  resolveMemberDisplayName,
} from '@/features/workspace-os/lib/member-display'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/page'

function memberLabel(member: WorkspaceMember) {
  return resolveMemberDisplayName({
    displayNameOverride: member.display_name_override,
    displayName: member.profiles?.display_name,
    email: member.email ?? member.profiles?.email,
  })
}

export function WorkspaceLoadBalancerPage() {
  const { t } = useTranslation()
  const { workspaceId, canManage } = useWorkspace()
  const qc = useQueryClient()

  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
  })
  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
  })
  const runs = useQuery({
    queryKey: loadBalancerKeys.runs(workspaceId),
    queryFn: () => listLoadBalanceRuns(workspaceId),
  })

  const preview = useMemo(() => {
    if (!tasks.data || !members.data) return null
    const unassigned = getUnassignedOpenTasks(tasks.data)
    const workloads = scoreMemberWorkloads(members.data, tasks.data)
    const suggestions = suggestAssignees(unassigned, workloads)
    return { unassigned, workloads, suggestions }
  }, [tasks.data, members.data])

  const memberMap = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.user_id, m])),
    [members.data],
  )

  const run = useMutation({
    mutationFn: (mode: 'suggest' | 'auto') => runLoadBalance(workspaceId, mode),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      await qc.invalidateQueries({ queryKey: loadBalancerKeys.runs(workspaceId) })
      toast.success(t('workspace.lbRunComplete', { defaultValue: 'Load balance run complete' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const loading = tasks.isLoading || members.isLoading

  return (
    <div>
      <PageHeader
        title={t('workspace.lbTitle', { defaultValue: 'Load balancer' })}
        description={t('workspace.lbDesc', {
          defaultValue: 'Suggest or auto-apply assignees based on workload and priority.',
        })}
        actions={
          canManage ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={run.isPending || !preview?.unassigned.length}
                onClick={() => run.mutate('suggest')}
              >
                <Sparkles className="size-4" />
                {t('workspace.lbSuggest', { defaultValue: 'Suggest' })}
              </Button>
              <Button
                size="sm"
                disabled={run.isPending || !preview?.unassigned.length}
                onClick={() => run.mutate('auto')}
              >
                <Zap className="size-4" />
                {t('workspace.lbAutoApply', { defaultValue: 'Auto apply' })}
              </Button>
            </>
          ) : null
        }
      />

      {loading ? (
        <Skeleton className="h-40" />
      ) : preview?.unassigned.length ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="size-4" />
                {t('workspace.lbUnassigned', { defaultValue: 'Unassigned tasks' })}
                <span className="text-xs font-normal text-muted">({preview.unassigned.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {preview.suggestions.map((item) => {
                const assignee = item.suggestedAssigneeId
                  ? memberMap.get(item.suggestedAssigneeId)
                  : null
                const name = assignee ? memberLabel(assignee) : '—'
                return (
                  <div
                    key={item.taskId}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-surface/40 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.taskTitle}</p>
                      <p className="text-xs text-muted">
                        {item.priority} · {item.rationale}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-md bg-surface-2 px-2 py-1">{Math.round(item.score)}</span>
                      {assignee ? (
                        <span className="flex items-center gap-1">
                          <span className="flex size-6 items-center justify-center rounded-md bg-accent/15 text-[10px]">
                            {memberInitials(name)}
                          </span>
                          {name}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('workspace.lbWorkload', { defaultValue: 'Member workload' })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {preview.workloads.map((w) => {
                const member = memberMap.get(w.userId)
                const name = member ? memberLabel(member) : w.userId.slice(0, 8)
                return (
                  <div
                    key={w.userId}
                    className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2 text-sm"
                  >
                    <span>{name}</span>
                    <span className="text-xs text-muted">
                      {w.openCount} open · {w.urgentCount} urgent
                    </span>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      ) : (
        <EmptyState
          title={t('workspace.lbAllAssigned', { defaultValue: 'All tasks are assigned' })}
          description={t('workspace.lbAllAssignedDesc', {
            defaultValue: 'No unassigned open tasks in this workspace.',
          })}
        />
      )}

      {(runs.data ?? []).length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium">
            {t('workspace.lbRecentRuns', { defaultValue: 'Recent runs' })}
          </h2>
          <div className="space-y-2">
            {(runs.data ?? []).map((row) => (
              <div
                key={row.id}
                className="rounded-xl border border-border-subtle bg-surface/30 px-4 py-3 text-sm"
              >
                <span className="font-medium">{row.mode}</span>
                <span className="text-muted"> · {row.summary}</span>
                <span className="block text-xs text-muted">
                  {new Date(row.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
