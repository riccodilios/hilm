import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  listWorkspaceProjects,
  listWorkspaceTasks,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { ReportBuilder, type ReportStats } from '@/features/reports/ReportBuilder'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { supabase } from '@/lib/supabase/client'
import { requireUserId } from '@/lib/supabase/activity'
import type { Json, Tables } from '@/types/database'

export const workspaceReportsKeys = {
  all: (workspaceId: string) => [...workspaceKeys.all, 'reports', workspaceId] as const,
  list: (workspaceId: string) => [...workspaceReportsKeys.all(workspaceId), 'list'] as const,
}

async function saveWorkspaceReport(
  workspaceId: string,
  input: { reportType: string; title: string; contentHtml: string },
) {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('workspace_ai_reports')
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      report_type: input.reportType,
      title: input.title,
      content_html: input.contentHtml,
      branding: {} as Json,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Tables<'workspace_ai_reports'>
}

async function listWorkspaceReports(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_ai_reports')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return (data ?? []) as Tables<'workspace_ai_reports'>[]
}

function dueKey(task: { due_date: string | null; due_at: string | null }) {
  if (task.due_date) return task.due_date.slice(0, 10)
  if (task.due_at) {
    const d = new Date(task.due_at)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return null
}

export function WorkspaceReportsPage() {
  const { t } = useTranslation()
  const { workspaceId, workspace } = useWorkspace()
  const qc = useQueryClient()
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const projects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
  })
  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
  })
  const saved = useQuery({
    queryKey: workspaceReportsKeys.list(workspaceId),
    queryFn: () => listWorkspaceReports(workspaceId),
  })

  const stats: ReportStats | null = useMemo(() => {
    if (!projects.data || !tasks.data) return null
    const open = tasks.data.filter((task) => task.status !== 'done' && task.status !== 'archived')
    const done = tasks.data.filter((task) => task.status === 'done')
    const overdue = open.filter((task) => {
      const key = dueKey(task)
      return key != null && key < todayKey
    })
    const statusMap = new Map<string, number>()
    const priorityMap = new Map<string, number>()
    for (const task of tasks.data) {
      statusMap.set(task.status, (statusMap.get(task.status) ?? 0) + 1)
      priorityMap.set(task.priority, (priorityMap.get(task.priority) ?? 0) + 1)
    }
    return {
      title: t('workspace.reportsDefaultTitle', {
        defaultValue: '{{name}} report',
        name: workspace.name,
      }),
      subtitle: t('workspace.reportsSubtitle', { defaultValue: 'Workspace projects and tasks' }),
      projectCount: projects.data.length,
      openTaskCount: open.length,
      doneTaskCount: done.length,
      overdueCount: overdue.length,
      byStatus: [...statusMap.entries()].map(([label, value]) => ({ label, value })),
      byPriority: [...priorityMap.entries()].map(([label, value]) => ({ label, value })),
    }
  }, [projects.data, tasks.data, t, workspace.name, todayKey])

  const save = useMutation({
    mutationFn: (input: { reportType: string; title: string; contentHtml: string }) =>
      saveWorkspaceReport(workspaceId, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceReportsKeys.list(workspaceId) })
      toast.success(t('workspace.reportsSaved', { defaultValue: 'Report saved' }))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const loading = projects.isLoading || tasks.isLoading

  return (
    <div>
      <PageHeader
        title={t('workspace.reportsTitle', { defaultValue: 'Reports' })}
        description={t('workspace.reportsDesc', {
          defaultValue: 'Build and export reports from workspace projects and tasks.',
        })}
      />

      {loading || !stats ? (
        <Skeleton className="h-64" />
      ) : (
        <ReportBuilder
          mode="workspace"
          stats={stats}
          onSave={(input) => save.mutateAsync(input)}
          saving={save.isPending}
        />
      )}

      {(saved.data ?? []).length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium">
            {t('workspace.reportsRecent', { defaultValue: 'Recent reports' })}
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
