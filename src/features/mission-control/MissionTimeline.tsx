import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { todayLocalISO } from '@/lib/dates'
import { ProjectIcon } from '@/features/projects/icons'
import { useFormatTime } from '@/hooks/useTimeFormat'
import {
  DAY_END,
  DAY_START,
  HOUR_HEIGHT,
  hourFromTimelineY,
  packDayTimeline,
  taskDurationHours,
} from '@/features/mission-control/lib/schedule'
import {
  timelineMetricsAtPoint,
  useMissionPointerDrag,
} from '@/features/mission-control/useMissionPointerDrag'
import type { TaskWithProject } from '@/features/tasks/reminders'

const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)

export function MissionTimeline({
  dayKey,
  tasks,
  projectFilter,
  onOpenTask,
  onReschedule,
  onComplete,
  onEmptySlotClick,
  optimisticTasks,
}: {
  dayKey: string
  tasks: TaskWithProject[]
  projectFilter: string | 'all'
  onOpenTask: (task: TaskWithProject) => void
  onReschedule: (
    taskId: string,
    dayKey: string,
    hour: number,
    durationHours?: number,
  ) => void | Promise<void>
  onComplete: (taskId: string) => void
  onEmptySlotClick?: (dayKey: string, hour: number) => void
  optimisticTasks?: TaskWithProject[] | null
}) {
  const { t, i18n } = useTranslation()
  const { formatHour } = useFormatTime()
  const dateLocale = i18n.language.startsWith('ar') ? ar : enUS
  const scrollRef = useRef<HTMLDivElement>(null)
  const isToday = dayKey === todayLocalISO()
  const scheduleTitle = isToday
    ? t('mission.todaySchedule')
    : t('mission.daySchedule', {
        day: format(parseISO(dayKey), 'EEEE, MMM d', { locale: dateLocale }),
      })

  const [nowHour, setNowHour] = useState(() => {
    const now = new Date()
    return now.getHours() + now.getMinutes() / 60
  })
  const [localTasks, setLocalTasks] = useState<TaskWithProject[] | null>(null)
  const [previewHour, setPreviewHour] = useState<number | null>(null)

  useEffect(() => {
    setLocalTasks(null)
  }, [tasks, dayKey])

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date()
      setNowHour(now.getHours() + now.getMinutes() / 60)
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isToday) return
    const top = Math.max(0, nowHour * HOUR_HEIGHT - el.clientHeight / 3)
    el.scrollTo({ top, behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once when day becomes today
  }, [dayKey, isToday])

  const sourceTasks = optimisticTasks ?? localTasks ?? tasks

  const filtered = useMemo(
    () =>
      sourceTasks.filter(
        (task) =>
          task.status !== 'archived' &&
          (projectFilter === 'all' || task.project_id === projectFilter),
      ),
    [sourceTasks, projectFilter],
  )

  function hourFromClientY(clientY: number) {
    const root = scrollRef.current
    if (!root) {
      const hit = timelineMetricsAtPoint(0, clientY)
      return hit ? hourFromTimelineY(hit.y) : 9
    }
    const rect = root.getBoundingClientRect()
    const y = clientY - rect.top + root.scrollTop - 8
    return hourFromTimelineY(y)
  }

  async function applyReschedule(taskId: string, hour: number, durationHours?: number) {
    const prev = sourceTasks
    const next = prev.map((task) => {
      if (task.id !== taskId) return task
      const whole = Math.floor(hour)
      const minutes = Math.round((hour - whole) * 60)
      const due = new Date(
        `${dayKey}T${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`,
      )
      return {
        ...task,
        due_date: dayKey,
        due_at: due.toISOString(),
        estimated_hours: durationHours ?? task.estimated_hours ?? taskDurationHours(task),
      }
    })
    setLocalTasks(next)
    try {
      await onReschedule(taskId, dayKey, hour, durationHours)
    } catch {
      setLocalTasks(prev)
    }
  }

  const drag = useMissionPointerDrag({
    onDragMove: (_taskId, _clientX, clientY) => {
      setPreviewHour(hourFromClientY(clientY))
    },
    onDragEnd: (taskId, _clientX, clientY) => {
      const hour = hourFromClientY(clientY)
      setPreviewHour(null)
      void applyReschedule(taskId, hour)
    },
  })

  const blocks = useMemo(() => {
    const packed = packDayTimeline(filtered, dayKey)
    if (!drag.activeTaskId || previewHour == null) return packed
    return packed.map((block) => {
      if (block.task.id !== drag.activeTaskId) return block
      const duration = taskDurationHours(block.task)
      const startHour = Math.max(DAY_START, Math.min(DAY_END - 0.25, previewHour))
      return {
        ...block,
        startHour,
        endHour: Math.min(DAY_END, startHour + duration),
        top: startHour * HOUR_HEIGHT,
        height: Math.max(28, duration * HOUR_HEIGHT - 4),
      }
    })
  }, [filtered, dayKey, drag.activeTaskId, previewHour])

  const showNow = isToday
  const nowTop = nowHour * HOUR_HEIGHT
  const draggingTask = drag.activeTaskId
    ? filtered.find((task) => task.id === drag.activeTaskId)
    : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('mission.timeline')}</p>
          <h2 className="mt-1 truncate text-lg font-medium">{scheduleTitle}</h2>
        </div>
        <p className="shrink-0 text-xs text-muted">
          {blocks.filter((block) => block.task.status !== 'done').length} {t('mission.openBlocks')}
        </p>
      </div>

      <div
        ref={scrollRef}
        data-mission-timeline
        className={cn(
          'relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border border-border-subtle bg-surface/40',
          drag.isDragging ? 'touch-none select-none' : 'touch-pan-y',
        )}
        onClick={(event) => {
          if (!onEmptySlotClick || drag.isDragging || drag.suppressClick()) return
          const target = event.target as HTMLElement
          if (target.closest('[data-timeline-block]')) return
          onEmptySlotClick(dayKey, hourFromClientY(event.clientY))
        }}
      >
        <div className="relative" style={{ height: (DAY_END - DAY_START) * HOUR_HEIGHT + 16 }}>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border-subtle/70"
              style={{ top: hour * HOUR_HEIGHT }}
            >
              <span className="absolute start-2 -translate-y-1/2 text-[10px] tabular-nums text-muted">
                {formatHour(hour)}
              </span>
            </div>
          ))}

          {showNow ? (
            <motion.div
              className="pointer-events-none absolute inset-x-0 z-20"
              style={{ top: nowTop }}
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2.4, repeat: Infinity }}
            >
              <div className="flex items-center gap-2 ps-14">
                <span className="size-2 rounded-full bg-danger" />
                <div className="h-px flex-1 bg-danger/80" />
              </div>
            </motion.div>
          ) : null}

          {blocks.map((block) => {
            const color = block.task.projects?.color || '#71717a'
            const done = block.task.status === 'done'
            const widthPct = 100 / block.columnCount
            const leftPct = block.column * widthPct
            const binders = done ? {} : drag.bindTask(block.task.id)
            const isDragging = drag.activeTaskId === block.task.id
            return (
              <div
                key={block.task.id}
                role="button"
                tabIndex={0}
                data-timeline-block
                {...binders}
                onClick={(e) => {
                  e.stopPropagation()
                  if (drag.isDragging || drag.suppressClick()) return
                  onOpenTask(block.task)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (!done) onComplete(block.task.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenTask(block.task)
                  }
                }}
                className={cn(
                  'absolute z-10 overflow-hidden rounded-xl border px-2 py-1.5 text-start shadow-sm transition-shadow',
                  'touch-pan-y select-none cursor-grab active:cursor-grabbing',
                  done && 'opacity-45 cursor-default',
                  isDragging && 'opacity-40 ring-2 ring-accent/60 z-30',
                )}
                style={{
                  top: block.top + 8,
                  height: block.height,
                  left: `calc(3.5rem + (100% - 4rem) * ${leftPct / 100})`,
                  width: `calc((100% - 4.25rem) * ${widthPct / 100} - 4px)`,
                  borderColor: `${color}66`,
                  background: `linear-gradient(90deg, ${color}22, transparent 70%)`,
                  backgroundColor: 'color-mix(in oklab, var(--color-surface) 88%, black)',
                }}
                title={t('mission.doubleComplete')}
              >
                <div className="flex items-start gap-1.5">
                  <span
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-background"
                    style={{ backgroundColor: color }}
                  >
                    <ProjectIcon icon={block.task.projects?.icon} size={10} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-xs font-medium sm:text-sm', done && 'line-through')}>
                      {block.task.title}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted">
                      {block.task.projects?.name ?? '—'} · {taskDurationHours(block.task)}h
                    </p>
                  </div>
                </div>
                {!done ? (
                  <span
                    className="absolute inset-x-2 bottom-0 h-4 cursor-ns-resize touch-pan-y"
                    onPointerDown={(e) => {
                      // Hold-to-resize: allow native scroll until armed (mirrors task drag).
                      e.stopPropagation()
                      const pointerId = e.pointerId
                      const startY = e.clientY
                      const startX = e.clientX
                      const startDuration = taskDurationHours(block.task)
                      const startHour = block.startHour
                      const target = e.currentTarget as HTMLElement
                      const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen'
                      let activated = !isTouch
                      let last = startDuration
                      let timer: number | null = null

                      const arm = () => {
                        if (activated) return
                        activated = true
                        target.style.touchAction = 'none'
                        try {
                          target.setPointerCapture(pointerId)
                        } catch {
                          /* ignore */
                        }
                      }

                      if (isTouch) {
                        timer = window.setTimeout(arm, 280)
                      } else {
                        arm()
                        e.preventDefault()
                      }

                      const onMove = (ev: PointerEvent) => {
                        if (ev.pointerId !== pointerId) return
                        const dx = ev.clientX - startX
                        const dy = ev.clientY - startY
                        if (!activated) {
                          if (Math.hypot(dx, dy) > 14) {
                            if (timer != null) window.clearTimeout(timer)
                            window.removeEventListener('pointermove', onMove)
                            window.removeEventListener('pointerup', onUp)
                            window.removeEventListener('pointercancel', onUp)
                          }
                          return
                        }
                        ev.preventDefault()
                        const deltaHours = (ev.clientY - startY) / HOUR_HEIGHT
                        const next = Math.max(0.5, Math.round((startDuration + deltaHours) * 4) / 4)
                        if (next === last) return
                        last = next
                        void applyReschedule(block.task.id, startHour, next)
                      }
                      const onUp = (ev: PointerEvent) => {
                        if (ev.pointerId !== pointerId) return
                        if (timer != null) window.clearTimeout(timer)
                        target.style.touchAction = ''
                        try {
                          if (target.hasPointerCapture?.(pointerId)) {
                            target.releasePointerCapture(pointerId)
                          }
                        } catch {
                          /* ignore */
                        }
                        window.removeEventListener('pointermove', onMove)
                        window.removeEventListener('pointerup', onUp)
                        window.removeEventListener('pointercancel', onUp)
                      }
                      window.addEventListener('pointermove', onMove, { passive: false })
                      window.addEventListener('pointerup', onUp)
                      window.addEventListener('pointercancel', onUp)
                    }}
                  />
                ) : null}
              </div>
            )
          })}

          {!blocks.length ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted">
              {t('mission.emptyTimeline')}
            </div>
          ) : null}
        </div>
      </div>

      {draggingTask && drag.ghost ? (
        <div
          className="pointer-events-none fixed z-[80] max-w-[12rem] truncate rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium shadow-xl"
          style={{
            left: drag.ghost.x + 14,
            top: drag.ghost.y + 14,
            borderColor: `${draggingTask.projects?.color || '#71717a'}88`,
          }}
        >
          {draggingTask.title}
          {previewHour != null ? (
            <span className="ms-2 text-[10px] text-muted">{formatHour(Math.floor(previewHour))}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
