import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { AiThinkingOrbs } from '@/features/ai/components/AiThinkingOrbs'
import { cn } from '@/lib/utils'
import type { MeetingStatus } from '../types'

const styles: Record<MeetingStatus, string> = {
  draft: 'bg-surface-3 text-muted',
  recording: 'bg-danger/15 text-danger',
  processing: 'bg-info/15 text-info',
  ready: 'bg-success/15 text-success',
  failed: 'bg-warning/15 text-warning',
}

export function MeetingStatusBadge({ status, className }: { status: MeetingStatus; className?: string }) {
  const { t } = useTranslation()
  return (
    <Badge className={cn('gap-1.5', styles[status], className)}>
      {status === 'recording' ? <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden /> : null}
      {status === 'processing' ? (
        <span aria-hidden className="-my-1 -ms-1">
          <AiThinkingOrbs state="thinking" size={18} />
        </span>
      ) : null}
      {t(`meetings.status.${status}`)}
    </Badge>
  )
}
