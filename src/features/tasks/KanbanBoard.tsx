import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { moveTask, listTasks, tasksKeys } from '@/features/tasks/api'
import { homeKeys } from '@/features/home/api'
import { projectsKeys } from '@/features/projects/api'
import { TaskActionsDialog } from '@/features/tasks/TaskActionsDialog'
import { useLongPress } from '@/hooks/useLongPress'
import { Badge, PriorityBadge } from '@/components/ui/badge'
import { ProjectBadge } from '@/components/ProjectBadge'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { cn } from '@/lib/utils'
import { KANBAN_COLUMNS } from '@/types/domain'
import type { TaskStatus } from '@/types/domain'
import type { TaskWithProject } from '@/features/tasks/reminders'

type Task = TaskWithProject

function TaskCard({
  task,
  overlay = false,
  onOpenMenu,
}: {
  task: Task
  overlay?: boolean
  onOpenMenu?: (task: Task) => void
}) {
  const navigate = useNavigate()
  const longPressed = useRef(false)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: overlay,
  })
  const longPress = useLongPress(
    () => {
      if (!onOpenMenu) return
      longPressed.current = true
      onOpenMenu(task)
    },
    { delayMs: 520 },
  )

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      {...(overlay ? {} : longPress)}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (isDragging || longPressed.current) {
          longPressed.current = false
          event.preventDefault()
          return
        }
        navigate(`/personal/tasks/${task.id}`)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(`/personal/tasks/${task.id}`)
        }
      }}
      className={cn(
        'block cursor-grab touch-manipulation select-none rounded-xl border border-border-subtle bg-surface p-3 shadow-sm transition hover:border-border active:cursor-grabbing',
        isDragging && !overlay && 'opacity-30',
        overlay && 'cursor-grabbing border-accent shadow-xl',
      )}
    >
      <p className="text-sm font-medium text-foreground">{task.title}</p>
      {task.projects ? <ProjectBadge {...task.projects} className="mt-2" /> : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <PriorityBadge priority={task.priority} />
        {task.due_at ? (
          <span className="text-xs text-muted">{new Date(task.due_at).toLocaleDateString()}</span>
        ) : null}
      </div>
    </div>
  )
}

function Column({
  status,
  tasks,
  onOpenMenu,
}: {
  status: TaskStatus
  tasks: Task[]
  onOpenMenu: (task: Task) => void
}) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex min-h-72 w-72 shrink-0 flex-col rounded-2xl border border-border-subtle bg-surface-2/50 p-3 transition-colors',
        isOver && 'border-accent bg-accent/5',
      )}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="text-sm font-medium capitalize">{t(`status.${status}`)}</h3>
        <Badge className="bg-surface-3 text-muted">{tasks.length}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onOpenMenu={onOpenMenu} />
        ))}
        {!tasks.length ? (
          <p className="px-1 py-6 text-center text-xs text-muted">{t('tasks.dropHere')}</p>
        ) : null}
      </div>
    </section>
  )
}

export function KanbanBoard({ projectId }: { projectId?: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [menuTask, setMenuTask] = useState<Task | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 10 } }))
  const { data: tasks, isLoading } = useQuery({
    queryKey: projectId ? tasksKeys.byProject(projectId) : tasksKeys.list(),
    queryFn: () => listTasks(projectId ? { projectId } : undefined),
  })
  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => moveTask(id, status),
    onSuccess: () => {
      void Promise.all([
        qc.invalidateQueries({ queryKey: tasksKeys.all }),
        qc.invalidateQueries({ queryKey: homeKeys.all }),
        qc.invalidateQueries({ queryKey: projectsKeys.all }),
      ])
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const columns = useMemo(
    () =>
      Object.fromEntries(
        KANBAN_COLUMNS.map((status) => [status, tasks?.filter((task) => task.status === status) ?? []]),
      ) as Record<TaskStatus, Task[]>,
    [tasks],
  )

  if (isLoading)
    return (
      <div className="flex gap-3 overflow-hidden">
        <Skeleton className="h-80 w-72 shrink-0" />
        <Skeleton className="h-80 w-72 shrink-0" />
      </div>
    )
  if (!tasks?.length)
    return <EmptyState title={t('tasks.emptyBoard')} description={t('tasks.emptyBoardBody')} />

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragEnd={({ active, over }) => {
          if (!over || !KANBAN_COLUMNS.includes(over.id as TaskStatus)) return
          const task = active.data.current?.task as Task | undefined
          const status = over.id as TaskStatus
          if (task && task.status !== status) move.mutate({ id: task.id, status })
        }}
      >
        <div className="overflow-x-auto pb-3">
          <div className="flex min-w-max gap-3">
            {KANBAN_COLUMNS.map((status) => (
              <Column key={status} status={status} tasks={columns[status]} onOpenMenu={setMenuTask} />
            ))}
          </div>
        </div>
        <DragOverlay>{null}</DragOverlay>
      </DndContext>
      <TaskActionsDialog task={menuTask} onClose={() => setMenuTask(null)} />
    </>
  )
}
