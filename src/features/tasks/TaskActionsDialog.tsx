import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Archive, Check, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { archiveTask, deleteTask, tasksKeys, updateTask } from '@/features/tasks/api'
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

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: tasksKeys.all }),
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
