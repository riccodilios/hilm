import { useTranslation } from 'react-i18next'

export function OfflineBanner() {
  const { t } = useTranslation()
  return (
    <div className="sticky top-0 z-30 border-b border-warning/20 bg-warning/10 px-4 py-2 text-center text-xs text-warning">
      {t('common.offline')}
    </div>
  )
}
