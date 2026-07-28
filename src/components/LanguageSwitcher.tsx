import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { AppLanguage } from '@/i18n'

export function LanguageSwitcher({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const { i18n, t } = useTranslation()
  const current = (i18n.language.startsWith('ar') ? 'ar' : 'en') as AppLanguage

  function setLanguage(lng: AppLanguage) {
    void i18n.changeLanguage(lng)
  }

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-xl border border-border bg-surface-2/60 p-1',
        className,
      )}
      role="group"
      aria-label={t('common.language')}
    >
      {(['en', 'ar'] as const).map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => setLanguage(lng)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            current === lng
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted hover:text-foreground',
          )}
        >
          {compact
            ? lng === 'ar'
              ? 'ع'
              : 'EN'
            : lng === 'ar'
              ? t('common.arabic')
              : t('common.english')}
        </button>
      ))}
    </div>
  )
}
