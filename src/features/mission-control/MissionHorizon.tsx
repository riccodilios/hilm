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

type HorizonMarker = {
  key: string
  label: string
  left: number
  hours: number
  title: string
  color: string
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

    const points: HorizonMarker[] = []

    for (const [key, dayTasks] of byDay) {
      const daysAhead = differenceInCalendarDays(parseISO(key), parseISO(today))
      const hours = dayTasks.reduce((sum, task) => sum + taskDurationHours(task), 0)
      const lead = [...dayTasks].sort((a, b) => {
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
              : format(parseISO(key), 'EEE d', { locale }),
        left: span <= 1 ? 12 : Math.min(94, Math.max(6, (daysAhead / span) * 88 + 6)),
        hours,
        title: lead?.title ?? key,
        color: lead?.projects?.color ?? '#71717a',
      })
    }

    if (focus) {
      const focusKey = taskDueDateKey(focus) ?? today
      if (!points.some((point) => point.key === focusKey)) {
        const daysAhead = Math.max(0, differenceInCalendarDays(parseISO(focusKey), parseISO(today)))
        if (daysAhead <= span) {
          points.push({
            key: focusKey,
            label: t('mission.horizonFocus'),
            left: span <= 1 ? 18 : Math.min(94, Math.max(6, (daysAhead / span) * 88 + 6)),
            hours: taskDurationHours(focus),
            title: focus.title,
            color: focus.projects?.color ?? '#71717a',
          })
        }
      }
    }

    // Spread markers that would collide when left% is too close.
    const sorted = points.sort((a, b) => a.left - b.left).slice(0, 6)
    const minGap = 14
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].left - sorted[i - 1].left < minGap) {
        sorted[i].left = Math.min(94, sorted[i - 1].left + minGap)
      }
    }
    return sorted
  }, [tasks, projectFilter, span, today, locale, t, focus])

  const endLabel = format(addDays(parseISO(today), span), zoom === 'year' ? 'MMM yyyy' : 'MMM d', {
    locale,
  })

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface/30 p-3 sm:p-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('mission.horizon')}</p>
          <p className="mt-0.5 truncate text-sm text-muted">
            {t('mission.horizonHint', { end: endLabel })}
          </p>
        </div>
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="inline-flex min-w-max rounded-xl border border-border bg-surface/60 p-1">
            {(['day', 'week', 'month', 'quarter', 'year'] as HorizonZoom[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onZoomChange(item)}
                className={cn(
                  'rounded-lg px-2.5 py-1.5 text-[11px] capitalize whitespace-nowrap',
                  zoom === item ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground',
                )}
              >
                {t(`mission.horizonZoom.${item}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: scrollable milestone chips — no absolute overlap */}
      <div className="flex gap-2 overflow-x-auto pb-1 sm:hidden">
        <HorizonChip
          active={selectedDay === today}
          label={t('mission.horizonNow')}
          title={t('mission.horizonNow')}
          color="var(--color-accent)"
          onClick={() => onSelectDay(today)}
        />
        {markers
          .filter((marker) => marker.key !== today)
          .map((marker) => (
            <HorizonChip
              key={`${marker.key}-${marker.title}`}
              active={selectedDay === marker.key}
              label={marker.label}
              title={marker.title}
              color={marker.color}
              hours={marker.hours}
              onClick={() => onSelectDay(marker.key)}
            />
          ))}
        <div className="flex shrink-0 items-center px-2 text-[11px] text-muted whitespace-nowrap">
          → {endLabel}
        </div>
      </div>

      {/* Desktop: rail with dots; labels live above, titles below with room */}
      <div className="relative hidden h-20 sm:block">
        <div className="absolute inset-x-3 top-[42%] h-px -translate-y-1/2 bg-border" />
        <button
          type="button"
          onClick={() => onSelectDay(today)}
          className="absolute top-[42%] z-10 flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: '4%' }}
        >
          <span className="mb-2 text-[10px] uppercase tracking-wide text-accent">
            {t('mission.horizonNow')}
          </span>
          <span className="size-2.5 rounded-full bg-accent shadow-[0_0_12px_color-mix(in_oklab,var(--color-accent)_60%,transparent)]" />
        </button>

        {markers.map((marker, index) => (
          <button
            key={`${marker.key}-${marker.title}`}
            type="button"
            title={`${marker.title} · ${marker.hours.toFixed(1)}h`}
            onClick={() => onSelectDay(marker.key)}
            className={cn(
              'absolute z-10 flex w-[5.5rem] -translate-x-1/2 flex-col items-center',
              index % 2 === 0 ? 'top-0' : 'bottom-0',
            )}
            style={{ left: `${marker.left}%` }}
          >
            {index % 2 === 0 ? (
              <>
                <span
                  className={cn(
                    'mb-1 w-full truncate text-center text-[10px]',
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
                <span className="mt-1 w-full truncate text-center text-[10px] text-muted">
                  {marker.title}
                </span>
              </>
            ) : (
              <>
                <span className="mb-1 w-full truncate text-center text-[10px] text-muted">
                  {marker.title}
                </span>
                <span
                  className={cn(
                    'size-2.5 rounded-full ring-2 ring-background transition-transform hover:scale-125',
                    marker.key === selectedDay && 'scale-125',
                  )}
                  style={{ backgroundColor: marker.color }}
                />
                <span
                  className={cn(
                    'mt-1 w-full truncate text-center text-[10px]',
                    marker.key === selectedDay ? 'text-foreground' : 'text-muted',
                  )}
                >
                  {marker.label}
                </span>
              </>
            )}
          </button>
        ))}

        <span className="absolute end-1 top-[42%] -translate-y-1/2 text-[10px] text-muted">
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

function HorizonChip({
  active,
  label,
  title,
  color,
  hours,
  onClick,
}: {
  active: boolean
  label: string
  title: string
  color: string
  hours?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-[8.5rem] shrink-0 flex-col gap-1 rounded-xl border px-3 py-2 text-start',
        active
          ? 'border-accent/40 bg-accent/10'
          : 'border-border-subtle bg-surface/50',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-[10px] uppercase tracking-wide text-muted">{label}</span>
      </span>
      <span className="truncate text-xs font-medium">{title}</span>
      {typeof hours === 'number' ? (
        <span className="text-[10px] tabular-nums text-muted">{hours.toFixed(1)}h</span>
      ) : null}
    </button>
  )
}
