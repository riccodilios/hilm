import { Link } from 'react-router-dom'
import { Download, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { FadeIn, Section } from '@/features/landing/primitives'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import { rtlMirrorClass } from '@/lib/rtl'
import { cn } from '@/lib/utils'

export function CtaSection() {
  const { canInstall, install } = usePwaInstall()
  const { t, i18n } = useTranslation()

  return (
    <Section>
      <FadeIn>
        <div className="relative overflow-hidden rounded-[2rem] border border-border bg-gradient-to-br from-surface via-[#12141a] to-surface-2 px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(96,165,250,0.12),transparent_55%)]" />
          <div className="relative">
            <h2 className="text-3xl font-medium tracking-tight sm:text-5xl">{t('landing.ctaTitle')}</h2>
            <p className="mx-auto mt-4 max-w-md text-base text-muted sm:text-lg">
              {t('landing.ctaBody')}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/signup">
                  {t('common.getStarted')} <ArrowRight className={cn('size-4', rtlMirrorClass(i18n.language))} />
                </Link>
              </Button>
              {canInstall ? (
                <Button size="lg" variant="secondary" onClick={() => void install()}>
                  <Download className="size-4" />
                  {t('common.installHilm')}
                </Button>
              ) : (
                <Button asChild size="lg" variant="secondary">
                  <Link to="/login">{t('common.signIn')}</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </FadeIn>
    </Section>
  )
}
