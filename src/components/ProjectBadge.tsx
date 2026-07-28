import { cn } from '@/lib/utils'
import { ProjectIcon } from '@/features/projects/icons'

type ProjectBadgeProps = {
  name: string
  color?: string | null
  icon?: string | null
  className?: string
  size?: 'sm' | 'md'
}

export function ProjectBadge({
  name,
  color = '#60a5fa',
  icon,
  className,
  size = 'sm',
}: ProjectBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2/80 font-medium text-foreground',
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs',
        className,
      )}
      title={name}
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-[4px] text-background',
          size === 'sm' ? 'size-3.5' : 'size-4',
        )}
        style={{ backgroundColor: color || '#60a5fa' }}
      >
        <ProjectIcon icon={icon} size={size === 'sm' ? 9 : 11} className="text-background" />
      </span>
      <span className="truncate">[{name}]</span>
    </span>
  )
}
