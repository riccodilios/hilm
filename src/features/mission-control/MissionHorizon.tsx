import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { ar, enUS } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { taskDueDateKey, todayLocalISO } from '@/lib/dates'
import { taskDurationHours, type HorizonZoom } from '@/features/mission-control/lib/schedule'
import type { TaskWithProject } from '@/features/tasks/reminders'

const ZOOM_DAYS: Record<HorizonZoom, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
}

export function MissionHorizon({
  zoom,
  onZoomChange,
  selectedDay,
  tasks,
  projectFilter,
  focus,
  onSelectDay,
}: {
  zoom: HorizonZoom
  onZoomChange: (zoom: HorizonZoom) => void
  selectedDay: string
  tasks: TaskWithProject[]
  projectFilter: string | 'all'
  focus: TaskWithProject | null
  onSelectDay: (dayKey: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('ar') ? ar : enUS
  const today = todayLocalISO()
  const span = ZOOM_DAYS[zoom]

  const markers = useMemo(() => {
    const open = tasks.filter(
      (task) =>
        task.status !== 'done' &&
        task.status !== 'archived' &&
        (projectFilter === 'all' || task.project_id === projectFilter),
    )
    const byDay = new Map<string, TaskWithProject[]>()
    for (const task of open) {
      const key = taskDueDateKey(task)
      if (!key) continue
      const daysAhead = differenceInCalendarDays(parseISO(key), parseISO(today))
      if (daysAhead < 0 || daysAhead > span) continue
      const list = byDay.get(key) ?? []
      list.push(task)
      byDay.set(key, list)
    }

    const points: {
      key: string
      label: string
      left: number
      hours: number
      title: string
      color: string
    }[] = []

    for (const [key, dayTasks] of byDay) {
      const daysAhead = differenceInCalendarDays(parseISO(key), parseISO(today))
      const hours = dayTasks.reduce((sum, task) => sum + taskDurationHours(task), 0)
      const lead = dayTasks.sort((a, b) => {
        const rank = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
        return rank[a.priority] - rank[b.priority]
      })[0]
      points.push({
        key,
        label:
          key === today
            ? t('mission.horizonNow')
            : daysAhead === 1
              ? t('mission.horizonTomorrow')
              : format(parseISO(key), zoom === 'day' ? 'HH:mm' : 'EEE d', { locale }),
        left: span <= 1 ? 8 : Math.min(96, Math.max(4, (daysAhead / span) * 92 + 4)),
        hours,
        title: lead?.title ?? key,
        color: lead?.projects?.color ?? '#71717a',
      })
    }

    if (focus) {
      const focusKey = taskDueDateKey(focus) ?? today
      if (!points.some((point) => point.key === focusKey)) {
        const daysAhead = Math.max(0, differenceInCalendarDays(parseISO(focusKey), parseISO(today)))
        points.push({
          key: focusKey,
          label: t('mission.horizonFocus'),
          left: span <= 1 ? 12 : Math.min(96, Math.max(4, (daysAhead / span) * 92 + 4)),
          hours: taskDurationHours(focus),
          title: focus.title,
          color: focus.projects?.color ?? '#71717a',
        })
      }
    }

    return points.sort((a, b) => a.left - b.left).slice(0, 8)
  }, [tasks, projectFilter, span, today, zoom, locale, t, focus])

  const endLabel = format(addDays(parseISO(today), span), zoom === 'year' ? 'MMM yyyy' : 'MMM d', {
    locale,
  })

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface/30 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('mission.horizon')}</p>
          <p className="mt-0.5 text-sm text-muted">
            {t('mission.horizonHint', { end: endLabel })}
          </p>
        </div>
        <div className="flex rounded-xl border border-border bg-surface/60 p-1">
          {(['day', 'week', 'month', 'quarter', 'year'] as HorizonZoom[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onZoomChange(item)}
              className={cn(
                'rounded-lg px-2 py-1 text-[11px] capitalize',
                zoom === item ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground',
              )}
            >
              {t(`mission.horizonZoom.${item}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-16">
        <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-border" />
        <button
          type="button"
          onClick={() => onSelectDay(today)}
          className="absolute top-1/2 z-10 flex -translate-y-1/2 flex-col items-center"
          style={{ left: '2%' }}
        >
          <span className="mb-1 text-[10px] uppercase tracking-wide text-accent">{t('mission.horizonNow')}</span>
          <span className="size-2.5 rounded-full bg-accent shadow-[0_0_12px_color-mix(in_oklab,var(--color-accent)_60%,transparent)]" />
        </button>

        {markers.map((marker) => (
          <button
            key={`${marker.key}-${marker.title}`}
            type="button"
            title={`${marker.title} · ${marker.hours.toFixed(1)}h`}
            onClick={() => onSelectDay(marker.key)}
            className="absolute top-1/2 z-10 flex max-w-[7rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${marker.left}%` }}
          >
            <span
              className={cn(
                'mb-1 truncate text-[10px]',
                marker.key === selectedDay ? 'text-foreground' : 'text-muted',
              )}
            >
              {marker.label}
            </span>
            <span
              className={cn(
                'size-2.5 rounded-full ring-2 ring-background transition-transform hover:scale-125',
                marker.key === selectedDay && 'scale-125',
              )}
              style={{ backgroundColor: marker.color }}
            />
            <span className="mt-1 truncate text-[10px] text-muted">{marker.title}</span>
          </button>
        ))}

        <span className="absolute end-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">
          {endLabel}
        </span>
      </div>

      {zoom === 'day' ? (
        <p className="mt-2 text-xs text-muted">
          {t('mission.horizonDayNote', {
            day: format(parseISO(selectedDay || today), 'EEEE, MMM d', { locale }),
          })}
        </p>
      ) : null}
    </section>
  )
}
