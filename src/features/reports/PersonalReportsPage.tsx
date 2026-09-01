import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { listTasks, tasksKeys } from '@/features/tasks/api'
import { getProfile, profileKeys } from '@/shared/user-profile'
import {
  listPersonalReports,
  rowToSnapshot,
  savePersonalReport,
} from '@/features/reports/personal-api'
import { ReportStudio } from '@/shared/reports/components/ReportStudio'
import type { ReportSnapshot } from '@/shared/reports/types'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { cn } from '@/lib/utils'

export const personalReportsKeys = {
  all: ['personal-reports'] as const,
  list: () => [...personalReportsKeys.all, 'list'] as const,
}

export function PersonalReportsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [reopen, setReopen] = useState<ReportSnapshot | null>(null)

  const profile = useQuery({ queryKey: profileKeys.me(), queryFn: getProfile })
  const projects = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const tasks = useQuery({ queryKey: tasksKeys.list(), queryFn: () => listTasks() })
  const saved = useQuery({ queryKey: personalReportsKeys.list(), queryFn: listPersonalReports })

  const generatedBy =
    profile.data?.display_name?.trim() ||
    t('reports.unnamedUser', { defaultValue: 'Personal account' })

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
      (tasks.data ?? []).map((task) => ({
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
      })),
    [tasks.data],
  )

  const save = useMutation({
    mutationFn: savePersonalReport,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: personalReportsKeys.list() })
      toast.success(t('reports.saved', { defaultValue: 'Report saved' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const loading = projects.isLoading || tasks.isLoading || profile.isLoading

  return (
    <div>
      <PageHeader
        title={t('reports.personalTitle', { defaultValue: 'Reports' })}
        description={t('reports.personalDesc', {
          defaultValue:
            'Generate professional branded PDF reports from your personal projects and tasks.',
        })}
      />

      {loading ? (
        <Skeleton className="h-64" />
      ) : (
        <ReportStudio
          os="personal"
          generatedBy={generatedBy}
          projects={sourceProjects}
          tasks={sourceTasks}
          onGenerate={(snapshot) => save.mutateAsync(snapshot)}
          generating={save.isPending}
          reopenSnapshot={reopen}
          onClearReopen={() => setReopen(null)}
        />
      )}

      {(saved.data ?? []).length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium">
            {t('reports.history', { defaultValue: 'Report history' })}
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
