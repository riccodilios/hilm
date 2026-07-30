import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  createWorkspaceTask,
  listWorkspaceProjects,
  listWorkspaceTasks,
  updateWorkspaceTask,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { cn } from '@/lib/utils'

export function WorkspaceTasksPage() {
  const { t } = useTranslation()
  const { workspaceId, canEdit } = useWorkspace()
  const [params] = useSearchParams()
  const projectFilter = params.get('project')
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(projectFilter ?? '')

  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
  })
  const projects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
  })

  const filtered = useMemo(
    () =>
      (tasks.data ?? []).filter((task) =>
        projectFilter ? task.project_id === projectFilter : true,
      ),
    [tasks.data, projectFilter],
  )

  const create = useMutation({
    mutationFn: () =>
      createWorkspaceTask(workspaceId, {
        projectId,
        title,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) })
      setOpen(false)
      setTitle('')
      toast.success(t('workspace.taskCreated'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const complete = useMutation({
    mutationFn: (taskId: string) =>
      updateWorkspaceTask(workspaceId, taskId, { status: 'done' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={t('nav.tasks')} description={t('workspace.tasksDesc')} />
        {canEdit ? (
          <Button
            onClick={() => {
              setProjectId(projectFilter || projects.data?.[0]?.id || '')
              setOpen(true)
            }}
          >
            <Plus className="size-4" /> {t('workspace.newTask')}
          </Button>
        ) : null}
      </div>

      {tasks.isLoading ? (
        <div className="mt-6 space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      ) : (
        <div className="mt-6 space-y-2">
          {filtered.map((task) => {
            const done = task.status === 'done'
            return (
              <div
                key={task.id}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface/40 px-4 py-3',
                  done && 'opacity-50',
                )}
              >
                {canEdit ? (
                  <button
                    type="button"
                    className="size-4 rounded border border-border"
                    aria-label="Complete"
                    onClick={() => !done && complete.mutate(task.id)}
                  />
                ) : null}
                <Link to={`/workspace/${workspaceId}/tasks/${task.id}`} className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm font-medium', done && 'line-through')}>{task.title}</p>
                  <p className="truncate text-xs text-muted">
                    {task.workspace_projects?.name ?? '—'} · {task.priority} · {task.status}
                  </p>
                </Link>
              </div>
            )
          })}
          {!filtered.length ? <p className="text-sm text-muted">{t('workspace.noTasks')}</p> : null}
        </div>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-lg font-medium">{t('workspace.newTask')}</h2>
            <div className="mt-4 space-y-3">
              <div>
                <Label htmlFor="t-title">{t('workspace.taskTitle')}</Label>
                <Input id="t-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="t-project">{t('nav.projects')}</Label>
                <select
                  id="t-project"
                  className="mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  {(projects.data ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
              <Button
                disabled={!title.trim() || !projectId || create.isPending}
                onClick={() => create.mutate()}
              >
                {t('common.create')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
