import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { addDays, format, parseISO } from 'date-fns'
import { Sparkles } from 'lucide-react'
import { HealthBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDueRemaining, taskDueDateKey, todayLocalISO, toLocalDateKey } from '@/lib/dates'
import { WorkloadHeatmap } from '@/features/mission-control/MissionCalendar'
import {
  buildAiSuggestions,
  heatmapDays,
  projectHoursForDay,
  taskDurationHours,
  workloadForDay,
} from '@/features/mission-control/lib/schedule'
import type { ProjectInsight } from '@/features/home/api'
import type { TaskWithProject } from '@/features/tasks/reminders'

function ProgressRing({ value, label }: { value: number; label: string }) {
  const size = 88
  const stroke = 7
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const offset = c - (pct / 100) * c
  return (
    <div className="relative flex size-[88px] items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-surface-3"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="text-accent"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-lg font-medium tabular-nums">{Math.round(pct)}%</p>
        <p className="text-[10px] text-muted">{label}</p>
      </div>
    </div>
  )
}

function BarSpark({
  values,
  labels,
  onSelect,
  selectedKey,
  keys,
}: {
  values: number[]
  labels: string[]
  keys: string[]
  selectedKey: string
  onSelect: (key: string) => void
}) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex h-16 items-end gap-1">
      {values.map((value, index) => (
        <button
          key={keys[index]}
          type="button"
          title={`${labels[index]}: ${value.toFixed(1)}h`}
          onClick={() => onSelect(keys[index])}
          className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
        >
          <motion.span
            className="w-full rounded-sm bg-accent/70 group-hover:bg-accent"
            style={{
              height: `${Math.max(6, (value / max) * 100)}%`,
              opacity: keys[index] === selectedKey ? 1 : 0.55,
            }}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(6, (value / max) * 100)}%` }}
            transition={{ duration: 0.45, delay: index * 0.03 }}
          />
          <span className="text-[9px] text-muted">{labels[index]}</span>
        </button>
      ))}
    </div>
  )
}

export function MissionOverview({
  dayKey,
  tasks,
  projects,
  projectFilter,
  focus,
  onSelectDay,
  onApplyBalance,
}: {
  dayKey: string
  tasks: TaskWithProject[]
  projects: ProjectInsight[]
  projectFilter: string | 'all'
  focus: TaskWithProject | null
  onSelectDay: (dayKey: string) => void
  onApplyBalance: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  const scoped = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status !== 'archived' &&
          (projectFilter === 'all' || task.project_id === projectFilter),
      ),
    [tasks, projectFilter],
  )

  const todayTasks = scoped.filter((task) => taskDueDateKey(task) === dayKey)
  const openToday = todayTasks.filter((task) => task.status !== 'done')
  const doneToday = todayTasks.filter((task) => task.status === 'done')
  const todayHours = workloadForDay(scoped, dayKey)
  const remainingHours = openToday.reduce((sum, task) => sum + taskDurationHours(task), 0)
  const progress = todayTasks.length ? (doneToday.length / todayTasks.length) * 100 : 0
  const distribution = projectHoursForDay(scoped, dayKey)
  const totalDist = distribution.reduce((sum, item) => sum + item.hours, 0) || 1
  const heat = heatmapDays(scoped, 10)
  const overdue = scoped.filter((task) => {
    const key = taskDueDateKey(task)
    return Boolean(key && key < todayLocalISO() && task.status !== 'done')
  })
  const tips = buildAiSuggestions({
    overdueCount: overdue.length,
    todayHours,
    projectCount: new Set(openToday.map((task) => task.project_id)).size,
    focusTitle: focus?.title,
  })

  const weekStart = parseISO(todayLocalISO())
  const weekKeys = Array.from({ length: 7 }, (_, i) =>
    toLocalDateKey(addDays(weekStart, i - ((weekStart.getDay() + 6) % 7)))!,
  )
  const weekValues = weekKeys.map((key) => workloadForDay(scoped, key))
  const weekLabels = weekKeys.map((key) => format(parseISO(key), 'EEEEE'))

  const monthPulse = heat.slice(-28)
  const monthDoneByWeek = Array.from({ length: 4 }, (_, week) => {
    const slice = monthPulse.slice(week * 7, week * 7 + 7)
    return slice.reduce((sum, cell) => {
      const done = scoped.filter(
        (task) => taskDueDateKey(task) === cell.key && task.status === 'done',
      ).length
      return sum + done
    }, 0)
  })

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden pe-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="min-w-0 shrink-0">
        <p className="text-xs uppercase tracking-[0.16em] text-muted">{t('mission.overview')}</p>
        <h2 className="mt-1 text-lg font-medium">{t('mission.missionBrief')}</h2>
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-4 rounded-2xl border border-border-subtle bg-surface/50 p-4">
        <ProgressRing value={progress} label={t('mission.today')} />
        <div className="min-w-0 space-y-1 text-sm">
          <p>
            <span className="tabular-nums text-foreground">{doneToday.length}</span>{' '}
            <span className="text-muted">{t('mission.completed')}</span>
          </p>
          <p>
            <span className="tabular-nums text-foreground">{openToday.length}</span>{' '}
            <span className="text-muted">{t('mission.remaining')}</span>
          </p>
          <p>
            <span className="tabular-nums text-foreground">{remainingHours.toFixed(1)}h</span>{' '}
            <span className="text-muted">{t('mission.hoursLeft')}</span>
          </p>
        </div>
      </div>

      {focus ? (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent">{t('mission.currentFocus')}</p>
          <p className="mt-1 truncate font-medium">{focus.title}</p>
          <p className="mt-1 text-xs text-muted">
            {focus.projects?.name ?? '—'} · {formatDueRemaining(focus, { locale })}
          </p>
          <Button asChild size="sm" variant="secondary" className="mt-3">
            <Link to={`/personal/tasks/${focus.id}`}>{t('mission.openFocus')}</Link>
          </Button>
        </div>
      ) : null}

      <section className="rounded-2xl border border-border-subtle bg-surface/40 p-4">
        <p className="mb-3 text-sm font-medium">{t('mission.projectMix')}</p>
        {distribution.length ? (
          <>
            <div className="relative mx-auto mb-3 size-28">
              <svg viewBox="0 0 36 36" className="-rotate-90">
                {(() => {
                  let offset = 0
                  return distribution.map((item) => {
                    const pct = (item.hours / totalDist) * 100
                    const dash = `${pct} ${100 - pct}`
                    const el = (
                      <circle
                        key={item.id}
                        cx="18"
                        cy="18"
                        r="15.5"
                        fill="none"
                        stroke={item.color}
                        strokeWidth="4"
                        strokeDasharray={dash}
                        strokeDashoffset={-offset}
                      />
                    )
                    offset += pct
                    return el
                  })
                })()}
              </svg>
            </div>
            <div className="space-y-1.5">
              {distribution.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="tabular-nums text-muted">{item.hours.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">{t('mission.noMix')}</p>
        )}
      </section>

      <section className="min-w-0 shrink-0 overflow-x-auto rounded-2xl border border-border-subtle bg-surface/40 p-4">
        <p className="mb-3 text-sm font-medium">{t('mission.weeklyLoad')}</p>
        <div className="min-w-[240px]">
        <BarSpark
          values={weekValues}
          labels={weekLabels}
          keys={weekKeys}
          selectedKey={dayKey}
          onSelect={onSelectDay}
        />
        </div>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface/40 p-4">
        <p className="mb-3 text-sm font-medium">{t('mission.productivity')}</p>
        <div className="flex h-12 items-end gap-2">
          {monthDoneByWeek.map((count, index) => (
            <motion.div
              key={index}
              className="flex-1 rounded-md bg-emerald-500/50"
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(12, Math.min(100, count * 18))}%` }}
              transition={{ duration: 0.5, delay: index * 0.05 }}
              title={`W${index + 1}: ${count}`}
            />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface/40 p-4">
        <p className="mb-2 text-sm font-medium">{t('mission.workload')}</p>
        <p className="mb-3 text-xs text-muted">{t('mission.workloadHint')}</p>
        <WorkloadHeatmap cells={heat} selectedDay={dayKey} onSelectDay={onSelectDay} />
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface/40 p-4">
        <p className="mb-3 text-sm font-medium">{t('mission.projectHealth')}</p>
        <div className="space-y-2">
          {projects.slice(0, 5).map((project) => (
            <Link
              key={project.id}
              to={`/personal/projects/${project.id}`}
              className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                <span className="truncate text-sm">{project.name}</span>
              </span>
              <HealthBadge health={project.health} />
            </Link>
          ))}
        </div>
      </section>

      {overdue.length ? (
        <section className="rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <p className="mb-2 text-sm font-medium text-danger">{t('mission.overdue')}</p>
          <div className="space-y-1">
            {overdue.slice(0, 4).map((task) => (
              <Link
                key={task.id}
                to={`/personal/tasks/${task.id}`}
                className="block truncate text-sm hover:underline"
              >
                {task.title}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border-subtle bg-surface/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-accent">
          <Sparkles className="size-4" />
          <p className="text-sm font-medium text-foreground">{t('mission.aiPlanning')}</p>
        </div>
        <ul className="space-y-2">
          {tips.map((tip) => (
            <li key={tip} className="text-sm leading-relaxed text-muted">
              {tip}
            </li>
          ))}
        </ul>
        <Button size="sm" className="mt-4 w-full" onClick={onApplyBalance}>
          {t('mission.applyBalance')}
        </Button>
      </section>
    </div>
  )
}
