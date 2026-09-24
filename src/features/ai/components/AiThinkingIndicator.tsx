import { cn } from '@/lib/utils'
import { AiThinkingOrbs, type ThinkingOrbState } from '@/features/ai/components/AiThinkingOrbs'

export function AiThinkingIndicator({
  label,
  state = 'thinking',
  className,
  size = 28,
}: {
  label: string
  state?: ThinkingOrbState
  className?: string
  size?: number
}) {
  return (
    <div
      className={cn('inline-flex items-center gap-3 text-sm text-muted', className)}
      role="status"
      aria-live="polite"
    >
      <AiThinkingOrbs state={state} size={size} label={label} />
      <span className="tracking-tight">{label}</span>
    </div>
  )
}
