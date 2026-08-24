import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Archive, Check, ExternalLink, FolderInput, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { archiveTask, deleteTask, tasksKeys, updateTask } from '@/features/tasks/api'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { homeKeys } from '@/features/home/api'
import { activityKeys } from '@/features/activity/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PriorityBadge, StatusBadge } from '@/components/ui/badge'
import type { TaskWithProject } from '@/features/tasks/reminders'

export function TaskActionsDialog({
  task,
  onClose,
}: {
  task: TaskWithProject | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: projects } = useQuery({
    queryKey: projectsKeys.list(),
    queryFn: listProjects,
    enabled: Boolean(task),
  })

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: tasksKeys.all }),
      qc.invalidateQueries({ queryKey: projectsKeys.all }),
      qc.invalidateQueries({ queryKey: homeKeys.all }),
      qc.invalidateQueries({ queryKey: activityKeys.all }),
    ])

  const complete = useMutation({
    mutationFn: (id: string) => updateTask(id, { status: 'done' }),
    onSuccess: async () => {
      await invalidate()
      onClose()
      toast.success(t('tasks.completed'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const moveProject = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      updateTask(id, { project_id: projectId }),
    onSuccess: async () => {
      await invalidate()
      onClose()
      toast.success(t('tasks.movedProject'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const archive = useMutation({
    mutationFn: (id: string) => archiveTask(id),
    onSuccess: async () => {
      await invalidate()
      onClose()
      toast.success(t('tasks.archived'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: async () => {
      await invalidate()
      onClose()
      toast.success(t('tasks.deleted'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const otherProjects = (projects ?? []).filter((project) => project.id !== task?.project_id)

  return (
    <Dialog open={Boolean(task)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-6">{task?.title}</DialogTitle>
          <DialogDescription>{t('tasks.actionsHint')}</DialogDescription>
        </DialogHeader>
        {task ? (
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
          </div>
        ) : null}
        <div className="grid gap-2">
          <Button
            variant="secondary"
            className="justify-start"
            onClick={() => {
              if (!task) return
              const id = task.id
              onClose()
              navigate(`/personal/tasks/${id}`)
            }}
          >
            <ExternalLink className="size-4" /> {t('tasks.open')}
          </Button>
          <Button
            variant="secondary"
            className="justify-start"
            onClick={() => {
              if (!task) return
              const id = task.id
              onClose()
              navigate(`/personal/tasks/${id}`)
            }}
          >
            <Pencil className="size-4" /> {t('tasks.edit')}
          </Button>
          {task && otherProjects.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border-subtle bg-surface/40 p-3">
              <Label htmlFor="move-project" className="flex items-center gap-2 text-xs">
                <FolderInput className="size-3.5" /> {t('tasks.moveToProject')}
              </Label>
              <select
                id="move-project"
                defaultValue=""
                disabled={moveProject.isPending}
                onChange={(event) => {
                  const projectId = event.target.value
                  if (!task || !projectId) return
                  moveProject.mutate({ id: task.id, projectId })
                }}
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
              >
                <option value="" disabled>
                  {t('tasks.chooseProject')}
                </option>
                {otherProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {task && task.status !== 'done' ? (
            <Button
              variant="secondary"
              className="justify-start"
              disabled={complete.isPending}
              onClick={() => task && complete.mutate(task.id)}
            >
              <Check className="size-4" /> {t('tasks.complete')}
            </Button>
          ) : null}
          {task && task.status !== 'archived' ? (
            <Button
              variant="secondary"
              className="justify-start"
              disabled={archive.isPending}
              onClick={() => task && archive.mutate(task.id)}
            >
              <Archive className="size-4" /> {t('tasks.archive')}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            className="justify-start text-[color:var(--color-danger)]"
            disabled={remove.isPending}
            onClick={() => {
              if (!task) return
              if (!window.confirm(t('tasks.deleteConfirm', { title: task.title }))) return
              remove.mutate(task.id)
            }}
          >
            <Trash2 className="size-4" /> {t('tasks.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
