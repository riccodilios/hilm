import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useTheme, type ThemeMode } from '@/hooks/useTheme'

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-surface-2/70 p-1',
        className,
      )}
      role="group"
      aria-label={t('settings.theme')}
    >
      {([
        { id: 'light' as ThemeMode, icon: Sun, label: t('settings.light') },
        { id: 'dark' as ThemeMode, icon: Moon, label: t('settings.dark') },
      ]).map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setTheme(option.id)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
            theme === option.id
              ? 'bg-accent text-accent-fg'
              : 'text-muted hover:text-foreground',
          )}
          aria-pressed={theme === option.id}
        >
          <option.icon className="size-3.5" />
          {option.label}
        </button>
      ))}
    </div>
  )
}
