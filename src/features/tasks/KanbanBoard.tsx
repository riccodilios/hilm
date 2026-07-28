import { useMemo } from 'react'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { moveTask, listTasks, tasksKeys } from '@/features/tasks/api'
import { Badge, PriorityBadge } from '@/components/ui/badge'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { cn } from '@/lib/utils'
import { KANBAN_COLUMNS } from '@/types/domain'
import type { TaskStatus } from '@/types/domain'
import type { Tables } from '@/types/database'

type Task = Tables<'tasks'>

function labelFor(status: TaskStatus) {
  return status.replace('_', ' ')
}

function TaskCard({ task, overlay = false }: { task: Task; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task } })
  return (
    <Link
      ref={setNodeRef}
      to={`/app/tasks/${task.id}`}
      {...attributes}
      {...listeners}
      onClick={(event) => {
        if (isDragging) event.preventDefault()
      }}
      className={cn(
        'block rounded-xl border border-border-subtle bg-surface p-3 shadow-sm transition hover:border-border',
        isDragging && !overlay && 'opacity-30',
        overlay && 'cursor-grabbing border-accent shadow-xl',
      )}
    >
      <p className="text-sm font-medium text-foreground">{task.title}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <PriorityBadge priority={task.priority} />
        {task.due_at ? <span className="text-xs text-muted">{new Date(task.due_at).toLocaleDateString()}</span> : null}
      </div>
    </Link>
  )
}

function Column({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
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
        <h3 className="text-sm font-medium capitalize">{labelFor(status)}</h3>
        <Badge className="bg-surface-3 text-muted">{tasks.length}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {tasks.map((task) => <TaskCard key={task.id} task={task} />)}
        {!tasks.length ? <p className="px-1 py-6 text-center text-xs text-muted">Drop tasks here</p> : null}
      </div>
    </section>
  )
}

export function KanbanBoard({ projectId }: { projectId?: string }) {
  const qc = useQueryClient()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const { data: tasks, isLoading } = useQuery({
    queryKey: projectId ? tasksKeys.byProject(projectId) : tasksKeys.list(),
    queryFn: () => listTasks(projectId ? { projectId } : undefined),
  })
  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => moveTask(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKeys.all }),
    onError: (error: Error) => toast.error(error.message),
  })
  const columns = useMemo(
    () => Object.fromEntries(KANBAN_COLUMNS.map((status) => [status, tasks?.filter((task) => task.status === status) ?? []])) as Record<TaskStatus, Task[]>,
    [tasks],
  )

  if (isLoading) return <div className="flex gap-3 overflow-hidden"><Skeleton className="h-80 w-72 shrink-0" /><Skeleton className="h-80 w-72 shrink-0" /></div>
  if (!tasks?.length) return <EmptyState title="No tasks on this board" description="Create a task to begin planning work." />

  return (
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
          {KANBAN_COLUMNS.map((status) => <Column key={status} status={status} tasks={columns[status]} />)}
        </div>
      </div>
      <DragOverlay>{null}</DragOverlay>
    </DndContext>
  )
}
