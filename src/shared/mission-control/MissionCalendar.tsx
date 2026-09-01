import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { format, isSameMonth } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { taskDueDateKey, toLocalDateKey, todayLocalISO } from '@/lib/dates'
import {
  heatTone,
  monthMatrix,
  taskDurationHours,
  weekDays,
  workloadForDay,
  type CalendarView,
} from '@/shared/mission-control/lib/schedule'
import {
  elementDayKeyAtPoint,
  useMissionPointerDrag,
} from '@/shared/mission-control/useMissionPointerDrag'
import type { TaskWithProject } from '@/shared/reminders'

export function MissionCalendar({
  view,
  anchor,
  selectedDay,
  tasks,
  projectFilter,
  onSelectDay,
  onDropTask,
  onOpenTask,
}: {
  view: CalendarView
  anchor: Date
  selectedDay: string
  tasks: TaskWithProject[]
  projectFilter: string | 'all'
  onSelectDay: (dayKey: string) => void
  onDropTask: (taskId: string, dayKey: string) => void
  onOpenTask: (task: TaskWithProject) => void
}) {
  const { i18n } = useTranslation()
  const locale = i18n.language.startsWith('ar') ? ar : enUS
  const filtered = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status !== 'archived' &&
          (projectFilter === 'all' || task.project_id === projectFilter),
      ),
    [tasks, projectFilter],
  )

  const drag = useMissionPointerDrag({
    resolveHoverKey: elementDayKeyAtPoint,
    onDragEnd: (taskId, clientX, clientY) => {
      const dayKey = elementDayKeyAtPoint(clientX, clientY)
      if (dayKey) onDropTask(taskId, dayKey)
    },
  })

  const days = view === 'month' ? monthMatrix(anchor) : view === 'week' ? weekDays(anchor) : [anchor]
  const draggingTask = drag.activeTaskId
    ? filtered.find((task) => task.id === drag.activeTaskId) ?? null
    : null

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {view === 'month' ? (
        <div className="grid grid-cols-7 gap-1 border-b border-border-subtle pb-2 text-center text-[10px] uppercase tracking-[0.14em] text-muted">
          {weekDays(anchor).map((day) => (
            <span key={day.toISOString()}>{format(day, 'EEE', { locale })}</span>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          'mt-2 min-h-0 flex-1 gap-1',
          view === 'month' && 'grid grid-cols-7 auto-rows-[minmax(4.5rem,1fr)]',
          view === 'week' && 'grid grid-cols-7',
          view === 'day' && 'grid grid-cols-1',
          drag.isDragging && 'touch-none select-none',
        )}
      >
        {days.map((day) => {
          const key = toLocalDateKey(day)!
          const limit = view === 'month' ? 3 : 12
          let dayTasks = filtered.filter((task) => taskDueDateKey(task) === key)

          // Live preview: pull dragged task out of its source day and into the hover day
          if (drag.activeTaskId && draggingTask) {
            dayTasks = dayTasks.filter((task) => task.id !== drag.activeTaskId)
            if (drag.hoverKey === key) {
              dayTasks = [draggingTask, ...dayTasks]
            }
          }

          const visible = dayTasks.slice(0, limit)
          const hours = workloadForDay(
            drag.activeTaskId
              ? filtered.map((task) =>
                  task.id === drag.activeTaskId && drag.hoverKey
                    ? { ...task, due_date: drag.hoverKey, due_at: `${drag.hoverKey}T09:00:00` }
                    : task,
                )
              : filtered,
            key,
          )
          const selected = key === selectedDay
          const today = key === todayLocalISO()
          const outside = view === 'month' && !isSameMonth(day, anchor)
          const dropTarget = drag.isDragging && drag.hoverKey === key
          const overflow = dayTasks.length - visible.length

          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              data-mission-day={key}
              onClick={() => {
                if (drag.isDragging || drag.suppressClick()) return
                onSelectDay(key)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectDay(key)
                }
              }}
              className={cn(
                'flex min-h-0 flex-col rounded-xl border p-1.5 text-start transition-colors',
                selected
                  ? 'border-accent/50 bg-accent/10'
                  : 'border-border-subtle bg-surface/40 hover:border-border hover:bg-surface',
                outside && 'opacity-40',
                today && !selected && 'ring-1 ring-accent/30',
                dropTarget && 'border-accent bg-accent/15 ring-2 ring-accent/40',
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    today ? 'font-semibold text-accent' : 'text-muted',
                    selected && 'text-foreground',
                  )}
                >
                  {format(day, view === 'day' ? 'EEEE d' : 'd', { locale })}
                </span>
                {hours > 0 ? (
                  <span className={cn('size-1.5 rounded-full', heatTone(hours))} title={`${hours}h`} />
                ) : null}
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
                {visible.map((task) => {
                  const binders = drag.bindTask(task.id)
                  const isDragSource = drag.activeTaskId === task.id
                  return (
                    <div
                      key={task.id}
                      {...binders}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (drag.isDragging || drag.suppressClick()) return
                        onOpenTask(task)
                      }}
                      className={cn(
                        'truncate rounded-md px-1.5 py-0.5 text-[10px] leading-tight text-background select-none',
                        'touch-manipulation cursor-grab active:cursor-grabbing',
                        task.status === 'done' && 'opacity-45 line-through',
                        isDragSource && 'opacity-25 ring-1 ring-white/40',
                        dropTarget && task.id === drag.activeTaskId && 'opacity-95',
                      )}
                      style={{ backgroundColor: task.projects?.color || '#71717a' }}
                      title={`${task.title} · ${taskDurationHours(task)}h`}
                    >
                      {task.title}
                    </div>
                  )
                })}
                {overflow > 0 ? (
                  <span className="px-1 text-[10px] text-muted">+{overflow}</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {draggingTask && drag.ghost ? (
        <div
          className="pointer-events-none fixed z-[80] max-w-[11rem] truncate rounded-md px-2.5 py-1.5 text-[11px] font-medium text-background shadow-xl"
          style={{
            left: drag.ghost.x + 14,
            top: drag.ghost.y + 14,
            backgroundColor: draggingTask.projects?.color || '#71717a',
          }}
        >
          {draggingTask.title}
        </div>
      ) : null}
    </div>
  )
}

export function WorkloadHeatmap({
  cells,
  selectedDay,
  onSelectDay,
}: {
  cells: { key: string; hours: number }[]
  selectedDay: string
  onSelectDay: (dayKey: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {cells.map((cell) => (
        <button
          key={cell.key}
          type="button"
          title={`${cell.key}: ${cell.hours.toFixed(1)}h`}
          onClick={() => onSelectDay(cell.key)}
          className={cn(
            'size-2.5 rounded-[3px] transition-transform hover:scale-125',
            heatTone(cell.hours),
            cell.key === selectedDay && 'ring-1 ring-foreground/70',
          )}
        />
      ))}
    </div>
  )
}
