import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { HealthBadge } from '@/components/ui/badge'
import { cn, formatRelative } from '@/lib/utils'
import { addLocalDays, taskDueDateKey, todayLocalISO } from '@/lib/dates'
import type { ProjectInsight } from '@/features/home/api'
import type { Momentum } from '@/features/projects/health'

function CompletionRing({ pct, color }: { pct: number; color: string }) {
  const size = 44
  const stroke = 3.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const offset = c - (clamped / 100) * c
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-surface-3"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
      />
    </svg>
  )
}

function MomentumMark({ momentum }: { momentum: Momentum }) {
  const { t } = useTranslation()
  const label =
    momentum === 'up'
      ? t('home.momentumUp')
      : momentum === 'down'
        ? t('home.momentumDown')
        : t('home.momentumFlat')
  return (
    <span
      className={cn(
        'text-[11px]',
        momentum === 'up' && 'text-success',
        momentum === 'down' && 'text-danger',
        momentum === 'flat' && 'text-muted',
      )}
      title={label}
    >
      {momentum === 'up' ? '↑' : momentum === 'down' ? '↓' : '→'} {label}
    </span>
  )
}

function nextDeadlineLabel(iso: string | null, t: (key: string) => string) {
  if (!iso) return null
  const key = taskDueDateKey({ due_at: iso }) ?? taskDueDateKey({ due_date: iso })
  if (!key) return null
  const today = todayLocalISO()
  if (key < today) return t('home.deadlineOverdue')
  if (key === today) return t('home.deadlineToday')
  if (key === addLocalDays(today, 1)) return t('home.deadlineTomorrow')
  return key
}

export function ProjectInsightCard({
  project,
  compact = false,
}: {
  project: ProjectInsight
  compact?: boolean
}) {
  const { t } = useTranslation()
  const deadline = nextDeadlineLabel(project.nextDeadline, t)

  return (
    <Link
      to={`/app/projects/${project.id}`}
      className={cn(
        'flex gap-3 rounded-xl border border-border-subtle bg-surface/60 p-3 transition-colors hover:border-border hover:bg-surface',
        compact && 'items-center',
      )}
    >
      <div className="relative flex size-11 shrink-0 items-center justify-center">
        <CompletionRing pct={project.completion_pct} color={project.color || '#60a5fa'} />
        <span className="absolute text-[10px] font-medium tabular-nums text-foreground">
          {Math.round(project.completion_pct)}%
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <HealthBadge health={project.health} />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>
            {t('home.lastActive')}:{' '}
            {project.lastActiveAt ? formatRelative(project.lastActiveAt) : t('home.neverActive')}
          </span>
          <span>
            {project.remainingTasks} {t('home.tasksRemaining')}
          </span>
          {project.overdueCount > 0 ? (
            <span className="text-danger">
              {project.overdueCount} {t('home.overdueShort')}
            </span>
          ) : null}
          {deadline ? (
            <span>
              {t('home.nextDeadline')}: {deadline}
            </span>
          ) : null}
          <MomentumMark momentum={project.momentum} />
        </div>
      </div>
    </Link>
  )
}
