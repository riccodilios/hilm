import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Bell, Columns3, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createTask, listTasks, tasksKeys } from '@/features/tasks/api'
import { homeKeys } from '@/features/home/api'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { TaskListItem } from '@/features/tasks/TaskListItem'
import { TaskActionsDialog } from '@/features/tasks/TaskActionsDialog'
import {
  countUnreadNotifications,
  notificationsKeys,
} from '@/features/notifications/api'
import { NotificationsList } from '@/features/notifications/NotificationsList'
import { REMINDER_OPTIONS, type ReminderType, type TaskWithProject } from '@/features/tasks/reminders'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/page'
import { PRIORITIES, TASK_STATUSES } from '@/types/domain'
import type { Priority, TaskStatus } from '@/types/domain'

export function TasksPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState<TaskStatus | undefined>()
  const [open, setOpen] = useState(searchParams.get('new') === '1')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [priority, setPriority] = useState<Priority>('none')
  const [dueAt, setDueAt] = useState('')
  const [reminderType, setReminderType] = useState<ReminderType>('1h')
  const [menuTask, setMenuTask] = useState<TaskWithProject | null>(null)
  const unread = useQuery({
    queryKey: notificationsKeys.unreadCount(),
    queryFn: countUnreadNotifications,
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
  const unreadCount = unread.data ?? 0
  const { data: tasks, isLoading } = useQuery({
    queryKey: tasksKeys.list(status),
    queryFn: () => listTasks(status ? { status } : undefined),
  })
  const { data: projects } = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  const create = useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: tasksKeys.all }),
        qc.invalidateQueries({ queryKey: homeKeys.all }),
      ])
      setOpen(false)
      setSearchParams({})
      setTitle('')
      setProjectId('')
      setPriority('none')
      setDueAt('')
      setReminderType('1h')
      toast.success(t('tasks.new'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  useEffect(() => {
    if (searchParams.get('new') === '1') setOpen(true)
  }, [searchParams])

  useEffect(() => {
    if (!projectId && projects?.[0]) setProjectId(projects[0].id)
  }, [projectId, projects])

  return (
    <div>
      <PageHeader
        title={t('tasks.title')}
        description={t('tasks.actionsHint')}
        actions={
          <>
            <Button
              variant="secondary"
              size="icon"
              className="relative"
              aria-label={t('nav.notifications')}
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell className="size-4" />
              {unreadCount > 0 ? (
                <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium leading-none text-background">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </Button>
            <Button variant="secondary" asChild>
              <Link to="/app/tasks/board">
                <Columns3 /> {t('tasks.board')}
              </Link>
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus /> {t('tasks.new')}
            </Button>
          </>
        }
      />
      <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('nav.notifications')}</DialogTitle>
            <DialogDescription>{t('notifications.panelDesc')}</DialogDescription>
          </DialogHeader>
          <NotificationsList compact />
        </DialogContent>
      </Dialog>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button size="sm" variant={!status ? 'default' : 'secondary'} onClick={() => setStatus(undefined)}>
          {t('common.open')}
        </Button>
        {TASK_STATUSES.filter((item) => item !== 'archived').map((item) => (
          <Button
            key={item}
            size="sm"
            variant={status === item ? 'default' : 'secondary'}
            onClick={() => setStatus(item)}
            className="capitalize"
          >
            {t(`status.${item}`)}
          </Button>
        ))}
      </div>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : !tasks?.length ? (
        <EmptyState
          title={t('tasks.emptyBoard')}
          description={t('tasks.emptyBoardBody')}
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus /> {t('tasks.new')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskListItem key={task.id} task={task} onOpenMenu={setMenuTask} />
          ))}
        </div>
      )}

      <TaskActionsDialog task={menuTask} onClose={() => setMenuTask(null)} />

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearchParams({})
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tasks.new')}</DialogTitle>
            <DialogDescription>{t('tasks.emptyBoardBody')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate({
                title,
                projectId,
                priority,
                dueDate: dueAt || null,
                reminderType,
              })
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="task-title">{t('projects.name')}</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-project">{t('projects.title')}</Label>
              <select
                id="task-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                required
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              >
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="task-priority">{t('tasks.priority')}</Label>
                <select
                  id="task-priority"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as Priority)}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                >
                  {PRIORITIES.map((item) => (
                    <option key={item} value={item}>
                      {t(`priority.${item}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="task-due">{t('tasks.due')}</Label>
                <Input id="task-due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="task-reminder">{t('tasks.reminder')}</Label>
                <select
                  id="task-reminder"
                  value={reminderType}
                  onChange={(event) => setReminderType(event.target.value as ReminderType)}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                >
                  {REMINDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={create.isPending || !projectId}>
              {t('common.create')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
