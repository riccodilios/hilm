import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  listWorkspaceMembers,
  listWorkspaceTasks,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { listDepartments, listTeams, orgKeys } from '@/features/workspace-os/org-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { useOrgVisibility } from '@/features/workspace-os/context/OrgVisibilityProvider'
import { cn } from '@/lib/utils'

export function OrgLeadershipHealth() {
  const { t } = useTranslation()
  const { workspaceId } = useWorkspace()
  const { filterTasks, visibleDepartmentIds } = useOrgVisibility()

  const departments = useQuery({
    queryKey: orgKeys.departments(workspaceId),
    queryFn: () => listDepartments(workspaceId),
  })
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

  const rows = useMemo(() => {
    const visible = new Set(visibleDepartmentIds)
    const open = filterTasks(tasks.data ?? []).filter(
      (task) => task.status !== 'done' && task.status !== 'archived',
    )
    const now = Date.now()
    return (departments.data ?? [])
      .filter((d) => visible.has(d.id))
      .map((dept) => {
        const deptTeams = (teams.data ?? []).filter((team) => team.department_id === dept.id)
        const deptTasks = open.filter((task) => task.department_id === dept.id)
        const overdue = deptTasks.filter((task) => {
          const due = task.due_at ? new Date(task.due_at).getTime() : NaN
          return Number.isFinite(due) && due < now
        }).length
        const awaitingLead = deptTasks.filter((task) => !task.assignee_id && task.team_id).length
        const load =
          deptTasks.length === 0
            ? 'low'
            : overdue >= 3 || deptTasks.length >= 12
              ? 'overloaded'
              : deptTasks.length >= 6
                ? 'high'
                : 'medium'
        return {
          id: dept.id,
          name: dept.name,
          teams: deptTeams.length,
          active: deptTasks.length,
          overdue,
          awaitingLead,
          load,
        }
      })
  }, [departments.data, teams.data, tasks.data, filterTasks, visibleDepartmentIds])

  if (!rows.length) return null

  return (
    <section className="mt-8 space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t('workspace.leadershipHealth')}</h2>
        <p className="text-xs text-muted">{t('workspace.leadershipHealthDesc')}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="rounded-xl border border-border-subtle bg-surface/50 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{row.name}</p>
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px]',
                  row.load === 'low' && 'bg-success/15 text-success',
                  row.load === 'medium' && 'bg-info/15 text-info',
                  row.load === 'high' && 'bg-warning/15 text-warning',
                  row.load === 'overloaded' && 'bg-danger/15 text-danger',
                )}
              >
                {t(`workspace.capacity.${row.load === 'overloaded' ? 'overloaded' : row.load}`)}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {t('workspace.deptHealthSummary', {
                teams: row.teams,
                active: row.active,
                overdue: row.overdue,
                queue: row.awaitingLead,
              })}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn(
                  'h-full rounded-full',
                  row.load === 'low' && 'bg-success',
                  row.load === 'medium' && 'bg-info',
                  row.load === 'high' && 'bg-warning',
                  row.load === 'overloaded' && 'bg-danger',
                )}
                style={{
                  width: `${Math.min(100, Math.max(8, row.active * 8 + row.overdue * 12))}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted">
        {t('workspace.memberCount', { count: members.data?.length ?? 0 })}
      </p>
    </section>
  )
}
