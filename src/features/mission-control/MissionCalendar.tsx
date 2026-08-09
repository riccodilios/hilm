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
} from '@/features/mission-control/lib/schedule'
import {
  elementDayKeyAtPoint,
  useMissionPointerDrag,
} from '@/features/mission-control/useMissionPointerDrag'
import type { TaskWithProject } from '@/features/tasks/reminders'

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
    ? filtered.find((task) => task.id === drag.activeTaskId)
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
          'mt-2 min-h-0 flex-1 gap-1 overflow-y-auto',
          view === 'month' && 'grid grid-cols-7 auto-rows-[minmax(4.5rem,1fr)]',
          view === 'week' && 'grid grid-cols-7',
          view === 'day' && 'grid grid-cols-1',
          drag.isDragging && 'touch-none',
        )}
        onDragOver={(event) => event.preventDefault()}
      >
        {days.map((day) => {
          const key = toLocalDateKey(day)!
          const dayTasks = filtered
            .filter((task) => taskDueDateKey(task) === key)
            .slice(0, view === 'month' ? 3 : 12)
          const hours = workloadForDay(filtered, key)
          const selected = key === selectedDay
          const today = key === todayLocalISO()
          const outside = view === 'month' && !isSameMonth(day, anchor)
          const dropTarget = drag.isDragging && drag.hoverKey === key

          return (
            <button
              key={key}
              type="button"
              data-mission-day={key}
              onClick={() => {
                if (drag.isDragging) return
                onSelectDay(key)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const taskId = event.dataTransfer.getData('text/task-id')
                if (taskId) onDropTask(taskId, key)
              }}
              className={cn(
                'flex min-h-0 flex-col rounded-xl border p-1.5 text-start transition-colors',
                selected
                  ? 'border-accent/50 bg-accent/10'
                  : 'border-border-subtle bg-surface/40 hover:border-border hover:bg-surface',
                outside && 'opacity-40',
                today && !selected && 'ring-1 ring-accent/30',
                dropTarget && 'border-accent bg-accent/15 ring-1 ring-accent/40',
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
                {dayTasks.map((task) => {
                  const binders = drag.bindTask(task.id)
                  return (
                    <div
                      key={task.id}
                      draggable
                      {...binders}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/task-id', task.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (drag.isDragging) return
                        onOpenTask(task)
                      }}
                      className={cn(
                        'truncate rounded-md px-1.5 py-0.5 text-[10px] leading-tight text-background touch-manipulation select-none',
                        task.status === 'done' && 'opacity-45 line-through',
                        drag.activeTaskId === task.id && 'opacity-30',
                      )}
                      style={{ backgroundColor: task.projects?.color || '#71717a' }}
                      title={`${task.title} · ${taskDurationHours(task)}h`}
                    >
                      {task.title}
                    </div>
                  )
                })}
                {filtered.filter((task) => taskDueDateKey(task) === key).length > dayTasks.length ? (
                  <span className="px-1 text-[10px] text-muted">
                    +{filtered.filter((task) => taskDueDateKey(task) === key).length - dayTasks.length}
                  </span>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>

      {draggingTask && drag.ghost ? (
        <div
          className="pointer-events-none fixed z-50 max-w-[10rem] truncate rounded-md px-2 py-1 text-[11px] text-background shadow-lg"
          style={{
            left: drag.ghost.x + 12,
            top: drag.ghost.y + 12,
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
