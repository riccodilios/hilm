import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  deleteWorkspaceTask,
  getWorkspaceTask,
  updateWorkspaceTask,
  workspaceKeys,
} from '@/features/workspace-os/api'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { Button } from '@/components/ui/button'
import { PageHeader, Skeleton } from '@/components/ui/page'

export function WorkspaceTaskDetailPage() {
  const { t } = useTranslation()
  const { taskId = '' } = useParams()
  const { workspaceId, canEdit } = useWorkspace()
  const qc = useQueryClient()
  const task = useQuery({
    queryKey: workspaceKeys.task(workspaceId, taskId),
    queryFn: () => getWorkspaceTask(workspaceId, taskId),
  })

  const save = useMutation({
    mutationFn: (status: 'todo' | 'in_progress' | 'done') =>
      updateWorkspaceTask(workspaceId, taskId, { status }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.task(workspaceId, taskId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      toast.success(t('workspace.taskUpdated'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => deleteWorkspaceTask(workspaceId, taskId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      toast.success(t('workspace.taskDeleted'))
      window.location.assign(`/workspace/${workspaceId}/tasks`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (task.isLoading) return <Skeleton className="h-40" />
  if (!task.data) return <p className="text-sm text-danger">{t('common.notFound')}</p>

  return (
    <div>
      <PageHeader
        title={task.data.title}
        description={`${task.data.workspace_projects?.name ?? '—'} · ${task.data.status}`}
      />
      {task.data.description ? (
        <p className="mt-4 whitespace-pre-wrap text-sm text-muted">{task.data.description}</p>
      ) : null}
      {canEdit ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => save.mutate('todo')}>Todo</Button>
          <Button variant="secondary" onClick={() => save.mutate('in_progress')}>In progress</Button>
          <Button onClick={() => save.mutate('done')}>{t('common.complete')}</Button>
          <Button variant="ghost" onClick={() => remove.mutate()}>{t('common.delete')}</Button>
        </div>
      ) : null}
    </div>
  )
}
