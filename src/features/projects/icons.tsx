import type { LucideIcon } from 'lucide-react'
import {
  Briefcase,
  Building2,
  Code2,
  Folder,
  Globe2,
  Heart,
  Inbox,
  Lightbulb,
  Milestone,
  Rocket,
  Sparkles,
  Target,
  Wallet,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export const PROJECT_ICONS = [
  { id: 'folder', Icon: Folder },
  { id: 'rocket', Icon: Rocket },
  { id: 'briefcase', Icon: Briefcase },
  { id: 'code', Icon: Code2 },
  { id: 'sparkles', Icon: Sparkles },
  { id: 'target', Icon: Target },
  { id: 'lightbulb', Icon: Lightbulb },
  { id: 'globe', Icon: Globe2 },
  { id: 'building', Icon: Building2 },
  { id: 'wallet', Icon: Wallet },
  { id: 'zap', Icon: Zap },
  { id: 'heart', Icon: Heart },
  { id: 'milestone', Icon: Milestone },
  { id: 'inbox', Icon: Inbox },
] as const

export type ProjectIconId = (typeof PROJECT_ICONS)[number]['id']

const iconMap = Object.fromEntries(PROJECT_ICONS.map((item) => [item.id, item.Icon])) as Record<
  string,
  LucideIcon
>

export function getProjectIcon(icon?: string | null): LucideIcon {
  if (icon && iconMap[icon]) return iconMap[icon]
  return Folder
}

type ProjectIconProps = {
  icon?: string | null
  className?: string
  size?: number
}

export function ProjectIcon({ icon, className, size = 16 }: ProjectIconProps) {
  const Icon = getProjectIcon(icon)
  return <Icon className={className} size={size} aria-hidden />
}

type ProjectIconPickerProps = {
  value: string
  onChange: (icon: string) => void
  color?: string
}

export function ProjectIconPicker({ value, onChange, color = '#60a5fa' }: ProjectIconPickerProps) {
  return (
    <div className="grid grid-cols-7 gap-2 sm:grid-cols-7">
      {PROJECT_ICONS.map(({ id, Icon }) => {
        const selected = value === id
        return (
          <button
            key={id}
            type="button"
            aria-label={id}
            aria-pressed={selected}
            onClick={() => onChange(id)}
            className={cn(
              'flex size-9 items-center justify-center rounded-xl border transition-colors',
              selected
                ? 'border-foreground/40 text-background'
                : 'border-border-subtle bg-surface-2 text-muted hover:text-foreground',
            )}
            style={selected ? { backgroundColor: color } : undefined}
          >
            <Icon className="size-4" />
          </button>
        )
      })}
    </div>
  )
}
