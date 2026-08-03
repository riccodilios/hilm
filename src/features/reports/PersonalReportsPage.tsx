import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { listTasks, tasksKeys } from '@/features/tasks/api'
import { taskDueDateKey, todayLocalISO } from '@/lib/dates'
import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import { ReportBuilder, type ReportStats } from '@/features/reports/ReportBuilder'
import { PageHeader, Skeleton } from '@/components/ui/page'
import type { Json, Tables } from '@/types/database'

export const personalReportsKeys = {
  all: ['personal-reports'] as const,
  list: () => [...personalReportsKeys.all, 'list'] as const,
}

async function savePersonalReport(input: {
  reportType: string
  title: string
  contentHtml: string
}) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('ai_reports')
    .insert({
      user_id: userId,
      report_type: input.reportType,
      title: input.title,
      content_html: input.contentHtml,
      branding: {} as Json,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Tables<'ai_reports'>
}

async function listPersonalReports() {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('ai_reports')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return (data ?? []) as Tables<'ai_reports'>[]
}

export function PersonalReportsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const todayKey = todayLocalISO()

  const projects = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const tasks = useQuery({ queryKey: tasksKeys.list(), queryFn: () => listTasks() })
  const saved = useQuery({ queryKey: personalReportsKeys.list(), queryFn: listPersonalReports })

  const stats: ReportStats | null = useMemo(() => {
    if (!projects.data || !tasks.data) return null
    const open = tasks.data.filter((task) => task.status !== 'done' && task.status !== 'archived')
    const done = tasks.data.filter((task) => task.status === 'done')
    const overdue = open.filter((task) => {
      const key = taskDueDateKey(task)
      return key != null && key < todayKey
    })
    const statusMap = new Map<string, number>()
    const priorityMap = new Map<string, number>()
    for (const task of tasks.data) {
      statusMap.set(task.status, (statusMap.get(task.status) ?? 0) + 1)
      priorityMap.set(task.priority, (priorityMap.get(task.priority) ?? 0) + 1)
    }
    return {
      title: t('reports.defaultTitle', { defaultValue: 'Personal OS report' }),
      subtitle: t('reports.personalSubtitle', { defaultValue: 'Projects and tasks overview' }),
      projectCount: projects.data.length,
      openTaskCount: open.length,
      doneTaskCount: done.length,
      overdueCount: overdue.length,
      byStatus: [...statusMap.entries()].map(([label, value]) => ({ label, value })),
      byPriority: [...priorityMap.entries()].map(([label, value]) => ({ label, value })),
    }
  }, [projects.data, tasks.data, t, todayKey])

  const save = useMutation({
    mutationFn: savePersonalReport,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: personalReportsKeys.list() })
      toast.success(t('reports.saved', { defaultValue: 'Report saved' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const loading = projects.isLoading || tasks.isLoading

  return (
    <div>
      <PageHeader
        title={t('reports.personalTitle', { defaultValue: 'Reports' })}
        description={t('reports.personalDesc', {
          defaultValue: 'Build and export reports from your personal projects and tasks.',
        })}
      />

      {loading || !stats ? (
        <Skeleton className="h-64" />
      ) : (
        <ReportBuilder
          mode="personal"
          stats={stats}
          onSave={(input) => save.mutateAsync(input)}
          saving={save.isPending}
        />
      )}

      {(saved.data ?? []).length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium">
            {t('reports.recent', { defaultValue: 'Recent reports' })}
          </h2>
          <div className="space-y-2">
            {(saved.data ?? []).map((row) => (
              <div
                key={row.id}
                className="rounded-xl border border-border-subtle bg-surface/40 px-4 py-3 text-sm"
              >
                <span className="font-medium">{row.title}</span>
                <span className="text-muted"> · {row.report_type}</span>
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
