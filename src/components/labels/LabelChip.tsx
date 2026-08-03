import { cn } from '@/lib/utils'

export function LabelChip({
  name,
  color,
  className,
  onRemove,
}: {
  name: string
  color: string
  className?: string
  onRemove?: () => void
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{
        backgroundColor: `${color}22`,
        borderColor: `${color}55`,
        color,
      }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ms-0.5 rounded px-0.5 text-[10px] opacity-70 hover:opacity-100"
          aria-label={`Remove ${name}`}
        >
          ×
        </button>
      ) : null}
    </span>
  )
}
