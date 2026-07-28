import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { HealthStatus, Priority, TaskStatus } from '@/types/domain'

const healthStyles: Record<HealthStatus, string> = {
  healthy: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  blocked: 'bg-danger/15 text-danger',
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

export function HealthBadge({ health }: { health: HealthStatus }) {
  const { t } = useTranslation()
  return <Badge className={healthStyles[health]}>{t(`health.${health}`)}</Badge>
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useTranslation()
  return <Badge className={priorityStyles[priority]}>{t(`priority.${priority}`)}</Badge>
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation()
  return <Badge className="bg-surface-3 text-muted">{t(`status.${status}`)}</Badge>
}
