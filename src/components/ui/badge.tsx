import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ProjectHealth } from '@/features/projects/health'
import type { HealthStatus, Priority, TaskStatus } from '@/types/domain'

const healthStyles: Record<string, string> = {
  unengaged: 'bg-zinc-500/15 text-zinc-400',
  started: 'bg-sky-500/15 text-sky-400',
  active: 'bg-amber-500/15 text-amber-400',
  healthy: 'bg-success/15 text-success',
  near_completion: 'bg-violet-500/15 text-violet-400',
  blocked: 'bg-danger/15 text-danger',
  stalled: 'bg-zinc-700/40 text-zinc-300',
  warning: 'bg-warning/15 text-warning',
  critical: 'bg-danger/25 text-danger',
}

const priorityStyles: Record<Priority, string> = {
  none: 'bg-surface-3 text-muted',
  low: 'bg-info/15 text-info',
  medium: 'bg-warning/15 text-warning',
  high: 'bg-danger/15 text-danger',
  urgent: 'bg-danger/25 text-danger',
}

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        className,
      )}
      {...props}
    />
  )
}

export function HealthBadge({ health }: { health?: HealthStatus | ProjectHealth | null }) {
  const { t } = useTranslation()
  const key = health || 'unengaged'
  const label =
    typeof health === 'string' ? health.replaceAll('_', ' ') : 'unengaged'
  return (
    <Badge className={healthStyles[key] ?? healthStyles.unengaged}>
      {t(`health.${key}`, { defaultValue: label })}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority?: Priority | null }) {
  const { t } = useTranslation()
  const key = priority && priority in priorityStyles ? priority : 'none'
  return <Badge className={priorityStyles[key]}>{t(`priority.${key}`)}</Badge>
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation()
  return <Badge className="bg-surface-3 text-muted">{t(`status.${status}`)}</Badge>
}
