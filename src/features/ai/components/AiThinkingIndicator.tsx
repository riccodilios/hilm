import { cn } from '@/lib/utils'

export function AiThinkingIndicator({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2.5 text-sm text-muted',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-6 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-accent/10 animate-pulse" />
        <span className="relative flex items-center gap-0.5">
          <span className="size-1 rounded-full bg-foreground/70 animate-[ai-dot_1.1s_ease-in-out_infinite]" />
          <span className="size-1 rounded-full bg-foreground/70 animate-[ai-dot_1.1s_ease-in-out_0.18s_infinite]" />
          <span className="size-1 rounded-full bg-foreground/70 animate-[ai-dot_1.1s_ease-in-out_0.36s_infinite]" />
        </span>
      </span>
      <span className="tracking-tight">{label}</span>
    </div>
  )
}
