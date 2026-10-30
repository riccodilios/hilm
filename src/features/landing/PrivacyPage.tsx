import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/page'
import { PublicFooter, PublicHeader } from '@/features/landing/public/PublicChrome'
import { usePublicPage } from '@/features/landing/public/PublicPage'
import { usePublicPageSeo } from '@/hooks/useDocumentSeo'
import { SITE } from '@/content/site.ts'

export function PrivacyPage() {
  const { t } = useTranslation()
  const { locale } = usePublicPage()
  usePublicPageSeo('privacy', locale)

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-5 py-12">
        <PageHeader title={t('privacy.title')} description={t('privacy.description')} />
        <div className="space-y-6 text-sm leading-relaxed text-muted">
          <p>{t('privacy.p1')}</p>
          <p>{t('privacy.p2')}</p>
          <p>{t('privacy.p3', { email: SITE.contactEmail })}</p>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}
