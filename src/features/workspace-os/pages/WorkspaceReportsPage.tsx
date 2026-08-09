import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  listWorkspaceMembers,
  listWorkspaceProjects,
  listWorkspaceTasks,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { listDepartments, listTeams, orgKeys } from '@/features/workspace-os/org-api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { useOrgVisibility } from '@/features/workspace-os/context/OrgVisibilityProvider'
import { getProfile, settingsKeys } from '@/features/settings/api'
import { resolveMemberDisplayName } from '@/features/workspace-os/lib/member-display'
import {
  listWorkspaceReports,
  rowToSnapshot,
  saveWorkspaceReport,
} from '@/features/reports/api'
import { ReportStudio } from '@/features/reports/components/ReportStudio'
import type { ReportSnapshot } from '@/features/reports/types'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { cn } from '@/lib/utils'

export const workspaceReportsKeys = {
  all: (workspaceId: string) => [...workspaceKeys.all, 'reports', workspaceId] as const,
  list: (workspaceId: string) => [...workspaceReportsKeys.all(workspaceId), 'list'] as const,
}

export function WorkspaceReportsPage() {
  const { t } = useTranslation()
  const { workspaceId, workspace } = useWorkspace()
  const { filterTasks, visibleDepartmentIds, canSeeAll } = useOrgVisibility()
  const qc = useQueryClient()
  const [reopen, setReopen] = useState<ReportSnapshot | null>(null)

  const profile = useQuery({ queryKey: settingsKeys.profile(), queryFn: getProfile })
  const projects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
  })
  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
  })
  const members = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => listWorkspaceMembers(workspaceId),
  })
  const departments = useQuery({
    queryKey: orgKeys.departments(workspaceId),
    queryFn: () => listDepartments(workspaceId),
  })
  const teams = useQuery({
    queryKey: orgKeys.teams(workspaceId),
    queryFn: () => listTeams(workspaceId),
  })
  const saved = useQuery({
    queryKey: workspaceReportsKeys.list(workspaceId),
    queryFn: () => listWorkspaceReports(workspaceId),
  })

  const generatedBy =
    profile.data?.display_name?.trim() ||
    t('reports.unnamedUser', { defaultValue: 'Workspace member' })

  const visibleDepts = useMemo(() => {
    const all = departments.data ?? []
    if (canSeeAll) return all
    return all.filter((dept) => visibleDepartmentIds.includes(dept.id))
  }, [departments.data, canSeeAll, visibleDepartmentIds])

  const visibleTeams = useMemo(() => {
    const all = teams.data ?? []
    if (canSeeAll) return all
    return all.filter(
      (team) => !team.department_id || visibleDepartmentIds.includes(team.department_id),
    )
  }, [teams.data, canSeeAll, visibleDepartmentIds])

  const visibleTasks = useMemo(() => filterTasks(tasks.data ?? []), [filterTasks, tasks.data])

  const sourceProjects = useMemo(
    () =>
      (projects.data ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        health: project.health,
        completion_pct: project.completion_pct,
        status: project.status,
      })),
    [projects.data],
  )

  const sourceTasks = useMemo(
    () =>
      visibleTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        project_id: task.project_id,
        due_date: task.due_date,
        due_at: task.due_at,
        completed_at: task.completed_at,
        created_at: task.created_at,
        estimated_hours: task.estimated_hours,
        assignee_id: task.assignee_id,
        department_id: task.department_id,
        team_id: task.team_id,
      })),
    [visibleTasks],
  )

  const sourceMembers = useMemo(
    () =>
      (members.data ?? []).map((member) => ({
        id: member.user_id,
        name: resolveMemberDisplayName({
          displayNameOverride: member.display_name_override,
          displayName: member.profiles?.display_name,
        }),
      })),
    [members.data],
  )

  const save = useMutation({
    mutationFn: (snapshot: ReportSnapshot) => saveWorkspaceReport(workspaceId, snapshot),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceReportsKeys.list(workspaceId) })
      toast.success(t('workspace.reportsSaved', { defaultValue: 'Report saved' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const loading =
    projects.isLoading ||
    tasks.isLoading ||
    profile.isLoading ||
    members.isLoading ||
    departments.isLoading ||
    teams.isLoading

  return (
    <div>
      <PageHeader
        title={t('workspace.reportsTitle', { defaultValue: 'Reports' })}
        description={t('workspace.reportsDesc', {
          defaultValue:
            'Generate organizationally aware branded PDF reports from workspace data you can access.',
          name: workspace.name,
        })}
      />

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <ReportStudio
          os="workspace"
          generatedBy={generatedBy}
          workspaceName={workspace.name}
          workspaceId={workspaceId}
          logoUrl={workspace.logo_url}
          projects={sourceProjects}
          tasks={sourceTasks}
          members={sourceMembers}
          departments={visibleDepts.map((d) => ({ id: d.id, name: d.name }))}
          teams={visibleTeams.map((team) => ({ id: team.id, name: team.name }))}
          onGenerate={(snapshot) => save.mutateAsync(snapshot)}
          generating={save.isPending}
          reopenSnapshot={reopen}
          onClearReopen={() => setReopen(null)}
        />
      )}

      {(saved.data ?? []).length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium">
            {t('workspace.reportsRecent', { defaultValue: 'Report history' })}
          </h2>
          <div className="space-y-2">
            {(saved.data ?? []).map((row) => {
              const snap = rowToSnapshot(row)
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    if (snap) {
                      setReopen(snap)
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    } else {
                      toast.error(
                        t('reports.reopenUnavailable', {
                          defaultValue: 'This older report has no reopenable snapshot.',
                        }),
                      )
                    }
                  }}
                  className={cn(
                    'flex w-full flex-col rounded-xl border border-border-subtle bg-surface/40 px-4 py-3 text-start text-sm transition-colors hover:border-border hover:bg-surface',
                  )}
                >
                  <span className="font-medium">{row.title}</span>
                  <span className="text-muted">
                    {row.report_type}
                    {row.generated_by_name ? ` · ${row.generated_by_name}` : ''}
                    {row.period_start && row.period_end
                      ? ` · ${row.period_start} → ${row.period_end}`
                      : ''}
                  </span>
                  <span className="mt-1 text-xs text-muted">
                    {new Date(row.created_at).toLocaleString()}
                    {row.status ? ` · ${row.status}` : ''}
                    {snap ? ` · ${t('reports.pdfReady', { defaultValue: 'PDF ready' })}` : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}
