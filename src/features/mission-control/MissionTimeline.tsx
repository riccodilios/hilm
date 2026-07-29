import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { ProjectIcon } from '@/features/projects/icons'
import {
  HOUR_HEIGHT,
  WORK_DAY_END,
  WORK_DAY_START,
  hourFromTimelineY,
  packDayTimeline,
  taskDurationHours,
} from '@/features/mission-control/lib/schedule'
import type { TaskWithProject } from '@/features/tasks/reminders'

const HOURS = Array.from({ length: WORK_DAY_END - WORK_DAY_START }, (_, i) => WORK_DAY_START + i)

export function MissionTimeline({
  dayKey,
  tasks,
  projectFilter,
  onOpenTask,
  onReschedule,
  onComplete,
}: {
  dayKey: string
  tasks: TaskWithProject[]
  projectFilter: string | 'all'
  onOpenTask: (task: TaskWithProject) => void
  onReschedule: (taskId: string, dayKey: string, hour: number) => void
  onComplete: (taskId: string) => void
}) {
  const { t } = useTranslation()
  const [nowHour, setNowHour] = useState(() => {
    const now = new Date()
    return now.getHours() + now.getMinutes() / 60
  })

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date()
      setNowHour(now.getHours() + now.getMinutes() / 60)
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])

  const filtered = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status !== 'archived' &&
          (projectFilter === 'all' || task.project_id === projectFilter),
      ),
    [tasks, projectFilter],
  )

  const blocks = useMemo(() => packDayTimeline(filtered, dayKey), [filtered, dayKey])
  const showNow = nowHour >= WORK_DAY_START && nowHour <= WORK_DAY_END
  const nowTop = (nowHour - WORK_DAY_START) * HOUR_HEIGHT

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('mission.timeline')}</p>
          <h2 className="mt-1 text-lg font-medium">{t('mission.todaySchedule')}</h2>
        </div>
        <p className="text-xs text-muted">
          {blocks.filter((block) => block.task.status !== 'done').length} {t('mission.openBlocks')}
        </p>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border-subtle bg-surface/40"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const taskId = event.dataTransfer.getData('text/task-id')
          if (!taskId) return
          const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect()
          const y = event.clientY - rect.top + (event.currentTarget as HTMLDivElement).scrollTop - 8
          onReschedule(taskId, dayKey, hourFromTimelineY(y))
        }}
      >
        <div
          className="relative"
          style={{ height: (WORK_DAY_END - WORK_DAY_START) * HOUR_HEIGHT + 16 }}
        >
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border-subtle/70"
              style={{ top: (hour - WORK_DAY_START) * HOUR_HEIGHT }}
            >
              <span className="absolute start-2 -translate-y-1/2 text-[10px] tabular-nums text-muted">
                {String(hour).padStart(2, '0')}:00
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
            const remaining = Math.max(0, block.endHour - Math.max(block.startHour, nowHour))
            return (
              <motion.button
                key={block.task.id}
                type="button"
                layout
                draggable
                onDragStart={(event) => {
                  const dataTransfer = (event as unknown as DragEvent).dataTransfer
                  dataTransfer?.setData('text/task-id', block.task.id)
                }}
                onClick={() => onOpenTask(block.task)}
                onDoubleClick={() => {
                  if (!done) onComplete(block.task.id)
                }}
                className={cn(
                  'absolute start-14 end-3 z-10 overflow-hidden rounded-xl border px-3 py-2 text-start shadow-sm transition-shadow hover:shadow-md',
                  done && 'opacity-45',
                )}
                style={{
                  top: block.top + 8,
                  height: block.height,
                  borderColor: `${color}66`,
                  background: `linear-gradient(90deg, ${color}22, transparent 70%)`,
                  backgroundColor: 'color-mix(in oklab, var(--color-surface) 88%, black)',
                }}
                title={t('mission.doubleComplete')}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-background"
                    style={{ backgroundColor: color }}
                  >
                    <ProjectIcon icon={block.task.projects?.icon} size={12} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium', done && 'line-through')}>
                      {block.task.title}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted">
                      {block.task.projects?.name ?? '—'} · {taskDurationHours(block.task)}h
                      {!done && remaining > 0 ? ` · ${remaining.toFixed(1)}h left` : null}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">
                    {block.task.priority}
                  </span>
                </div>
              </motion.button>
            )
          })}

          {!blocks.length ? (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted">
              {t('mission.emptyTimeline')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
