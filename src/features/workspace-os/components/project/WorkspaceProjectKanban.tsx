import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { updateWorkspaceTask, workspaceKeys, type WorkspaceTask } from '@/features/workspace-os/api'
import { TaskAssigneeLabel } from '@/features/workspace-os/components/TaskAssigneeLabel'
import { patchWorkspaceTasksCache } from '@/features/workspace-os/lib/workspace-cache'
import { Badge, PriorityBadge } from '@/components/ui/badge'
import { formatDueRemaining } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { KANBAN_COLUMNS, type TaskStatus } from '@/types/domain'

function KanbanCard({
  task,
  workspaceId,
  canEdit,
}: {
  task: WorkspaceTask
  workspaceId: string
  canEdit: boolean
}) {
  const { i18n } = useTranslation()
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !canEdit,
  })
  const open = () => navigate(`/workspace/${workspaceId}/tasks/${task.id}`)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!isDragging) open()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      className={cn(
        'touch-manipulation select-none rounded-xl border border-border-subtle bg-surface p-3 shadow-sm transition hover:border-border',
        canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        isDragging && 'opacity-30',
      )}
    >
      <p className={cn('text-sm font-medium', task.status === 'done' && 'text-muted line-through')}>{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PriorityBadge priority={task.priority} />
        <TaskAssigneeLabel assignee={task.assignee} assignment={task.assignment} compact />
      </div>
      {task.due_at || task.due_date ? (
        <p className="mt-2 text-[11px] text-muted">{formatDueRemaining(task, { locale: i18n.language })}</p>
      ) : null}
    </div>
  )
}

function KanbanColumn({
  status,
  tasks,
  workspaceId,
  canEdit,
}: {
  status: TaskStatus
  tasks: WorkspaceTask[]
  workspaceId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canEdit })
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex min-h-72 w-72 shrink-0 flex-col rounded-2xl border border-border-subtle bg-surface-2/50 p-3 transition-colors',
        isOver && 'border-accent bg-accent/5',
      )}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="text-sm font-medium">{t(`status.${status}`)}</h3>
        <Badge className="bg-surface-3 text-muted">{tasks.length}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {tasks.map((task) => (
          <KanbanCard key={task.id} task={task} workspaceId={workspaceId} canEdit={canEdit} />
        ))}
        {!tasks.length ? <p className="px-1 py-6 text-center text-xs text-muted">{t('tasks.dropHere')}</p> : null}
      </div>
    </section>
  )
}

/** Board of the project's tasks (already filtered to what the viewer may see). */
export function WorkspaceProjectKanban({
  workspaceId,
  tasks,
  canEdit,
}: {
  workspaceId: string
  tasks: WorkspaceTask[]
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 10 } }))
  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      updateWorkspaceTask(workspaceId, id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: workspaceKeys.tasks(workspaceId) })
      patchWorkspaceTasksCache(qc, workspaceId, id, {
        status,
        completed_at: status === 'done' ? new Date().toISOString() : null,
      })
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: workspaceKeys.tasks(workspaceId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.home(workspaceId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) }),
      ]),
    onError: (error: Error) => toast.error(error.message),
  })

  const columns = useMemo(
    () =>
      Object.fromEntries(
        KANBAN_COLUMNS.map((status) => [status, tasks.filter((task) => task.status === status)]),
      ) as Record<TaskStatus, WorkspaceTask[]>,
    [tasks],
  )

  return (
    <div className="space-y-2">
      {!canEdit ? <p className="text-xs text-muted">{t('workspace.kanbanReadOnly')}</p> : null}
      <DndContext
        sensors={sensors}
        onDragEnd={({ active, over }) => {
          if (!canEdit || !over || !KANBAN_COLUMNS.includes(over.id as TaskStatus)) return
          const task = active.data.current?.task as WorkspaceTask | undefined
          const status = over.id as TaskStatus
          if (task && task.status !== status) move.mutate({ id: task.id, status })
        }}
      >
        <div className="overflow-x-auto pb-3">
          <div className="flex min-w-max gap-3">
            {KANBAN_COLUMNS.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={columns[status]}
                workspaceId={workspaceId}
                canEdit={canEdit}
              />
            ))}
          </div>
        </div>
      </DndContext>
    </div>
  )
}
