import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/page'
import { Button } from '@/components/ui/button'

export function PrivacyPage() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-5 py-12">
      <Button asChild variant="ghost" size="sm" className="mb-8 px-0">
        <Link to="/">← {t('brand.name')}</Link>
      </Button>
      <PageHeader
        title={t('privacy.title')}
        description={t('privacy.description')}
      />
      <div className="space-y-6 text-sm leading-relaxed text-muted">
        <p>{t('privacy.p1')}</p>
        <p>{t('privacy.p2')}</p>
        <p>{t('privacy.p3', { email: 'hello@hilm.app' })}</p>
      </div>
    </div>
  )
}
