import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  createWorkspaceTask,
  listWorkspaceProjects,
  listWorkspaceTasks,
  updateWorkspaceTask,
  workspaceKeys,
} from '@/features/workspace-os/api'
import {
  TaskAssignmentFields,
  type TaskAssignmentValue,
} from '@/features/workspace-os/components/TaskAssignmentFields'
import { TaskAssigneeLabel } from '@/features/workspace-os/components/TaskAssigneeLabel'
import { useWorkspace } from '@/features/workspace-os/context/WorkspaceProvider'
import { REMINDER_OPTIONS, combineDueAt, computeRemindAt, type ReminderType } from '@/features/tasks/reminders'
import { PRIORITIES, type Priority } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader, Skeleton } from '@/components/ui/page'
import { PriorityBadge, StatusBadge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDueRemaining } from '@/lib/dates'
import { cn } from '@/lib/utils'

const EMPTY_ASSIGNMENT: TaskAssignmentValue = {
  departmentId: null,
  teamId: null,
  assigneeId: null,
}

export function WorkspaceTasksPage() {
  const { t, i18n } = useTranslation()
  const { workspaceId, canEdit } = useWorkspace()
  const [params, setSearchParams] = useSearchParams()
  const projectFilter = params.get('project')
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(projectFilter ?? '')
  const [priority, setPriority] = useState<Priority>('none')
  const [dueAt, setDueAt] = useState('')
  const [reminderType, setReminderType] = useState<ReminderType>('1h')
  const [assignment, setAssignment] = useState<TaskAssignmentValue>(EMPTY_ASSIGNMENT)

  const tasks = useQuery({
    queryKey: workspaceKeys.tasks(workspaceId),
    queryFn: () => listWorkspaceTasks(workspaceId),
  })
  const projects = useQuery({
    queryKey: workspaceKeys.projects(workspaceId),
    queryFn: () => listWorkspaceProjects(workspaceId),
  })

  useEffect(() => {
    if (params.get('new') === '1' && canEdit) {
      setProjectId(projectFilter || projects.data?.[0]?.id || '')
      setOpen(true)
    }
  }, [params, canEdit, projectFilter, projects.data])

  const filtered = useMemo(
    () =>
      (tasks.data ?? []).filter((task) =>
        projectFilter ? task.project_id === projectFilter : true,
      ),
    [tasks.data, projectFilter],
  )

  function resetForm() {
    setTitle('')
    setPriority('none')
    setDueAt('')
    setReminderType('1h')
    setAssignment(EMPTY_ASSIGNMENT)
  }

  const create = useMutation({
    mutationFn: () =>
      createWorkspaceTask(workspaceId, {
        projectId,
        title,
        priority,
        dueDate: dueAt || null,
        reminderType,
        departmentId: assignment.departmentId,
        teamId: assignment.teamId,
        assigneeId: assignment.assigneeId,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      await qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) })
      setOpen(false)
      resetForm()
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('new')
        return next
      })
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
    <div className="w-full min-w-0">
      <PageHeader
        title={t('nav.tasks')}
        description={t('workspace.tasksDesc')}
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setProjectId(projectFilter || projects.data?.[0]?.id || '')
                setOpen(true)
              }}
            >
              <Plus className="size-4" /> {t('workspace.newTask')}
            </Button>
          ) : null
        }
      />

      {tasks.isLoading ? (
        <div className="mt-2 space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((task, index) => {
            const done = task.status === 'done'
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.28 }}
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-border-subtle bg-surface/70 p-4 transition-colors hover:border-border hover:bg-surface',
                  done && 'opacity-55 grayscale-[0.35]',
                )}
              >
                {canEdit ? (
                  <button
                    type="button"
                    className={cn(
                      'size-5 shrink-0 rounded-md border border-border transition-colors',
                      done && 'border-success bg-success/20',
                    )}
                    aria-label={t('workspace.markDone')}
                    disabled={done || complete.isPending}
                    onClick={() => !done && complete.mutate(task.id)}
                  />
                ) : null}
                <Link
                  to={`/workspace/${workspaceId}/tasks/${task.id}`}
                  className="flex min-w-0 flex-1 items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className={cn('truncate font-medium', done && 'text-muted line-through')}>
                      {task.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {task.workspace_projects ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: task.workspace_projects.color }}
                          />
                          {task.workspace_projects.name}
                        </span>
                      ) : null}
                      <TaskAssigneeLabel assignee={task.assignee} />
                      <span>
                        {task.due_at || task.due_date
                          ? formatDueRemaining(task, { locale: i18n.language })
                          : t('home.noDueDate')}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <PriorityBadge priority={task.priority} />
                    <StatusBadge status={task.status} />
                  </div>
                </Link>
              </motion.div>
            )
          })}
          {!filtered.length ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
              <h3 className="text-base font-medium">{t('workspace.noTasks')}</h3>
              <p className="mt-1 text-sm text-muted">{t('tasks.emptyBoardBody')}</p>
              {canEdit ? (
                <Button
                  className="mt-4"
                  onClick={() => {
                    setProjectId(projectFilter || projects.data?.[0]?.id || '')
                    setOpen(true)
                  }}
                >
                  <Plus className="size-4" /> {t('workspace.newTask')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            resetForm()
            setSearchParams((prev) => {
              const nextParams = new URLSearchParams(prev)
              nextParams.delete('new')
              return nextParams
            })
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('tasks.new')}</DialogTitle>
            <DialogDescription>{t('tasks.emptyBoardBody')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!projectId || !title.trim()) return
              create.mutate()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="ws-task-title">{t('projects.name')}</Label>
              <Input
                id="ws-task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-task-project">{t('projects.title')}</Label>
              <select
                id="ws-task-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                required
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              >
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ws-task-priority">{t('tasks.priority')}</Label>
                <select
                  id="ws-task-priority"
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
                <Label htmlFor="ws-task-due">{t('tasks.due')}</Label>
                <Input
                  id="ws-task-due"
                  type="date"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ws-task-reminder">{t('tasks.reminder')}</Label>
                <select
                  id="ws-task-reminder"
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
                {dueAt ? (
                  <p className="text-[11px] text-muted">
                    {t('workspace.reminderHint', {
                      when:
                        computeRemindAt(combineDueAt(dueAt), reminderType)?.slice(0, 16).replace('T', ' ') ??
                        '—',
                    })}
                  </p>
                ) : null}
              </div>
            </div>
            <TaskAssignmentFields
              workspaceId={workspaceId}
              value={assignment}
              onChange={setAssignment}
              priority={priority}
              titleHint={title}
              dueAt={dueAt ? combineDueAt(dueAt) : null}
            />
            <Button type="submit" className="w-full" disabled={create.isPending || !projectId}>
              {t('common.create')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
