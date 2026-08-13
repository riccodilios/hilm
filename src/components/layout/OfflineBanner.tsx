import { useTranslation } from 'react-i18next'

export function OfflineBanner() {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-warning/20 bg-warning/10 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] text-center text-xs text-warning">
      {t('common.offline')}
    </div>
  )
}
