import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Download, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { HeroBackdrop } from '@/features/landing/HeroBackdrop'
import { PublicHeader } from '@/features/landing/public/PublicChrome'
import { usePublicPage } from '@/features/landing/public/PublicPage'
import { HOME_CONTENT } from '@/content/site.ts'
import { ensureLandingGsap, gsap, useGSAP } from '@/features/landing/gsap-setup'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import { rtlMirrorClass } from '@/lib/rtl'
import { cn } from '@/lib/utils'

ensureLandingGsap()

export function LandingHero() {
  const rootRef = useRef<HTMLElement>(null)
  const { canInstall, install } = usePwaInstall()
  const { t, i18n } = useTranslation()
  const { locale } = usePublicPage()

  useGSAP(
    () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        gsap.set('.hero-anim', { opacity: 1, y: 0, clearProps: 'transform' })
        return
      }

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      tl.fromTo('.hero-brand', { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.9, clearProps: 'transform' })
        .fromTo('.hero-sub', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7, clearProps: 'transform' }, '-=0.45')
        .fromTo('.hero-desc', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.65, clearProps: 'transform' }, '-=0.4')
        .fromTo('.hero-cta', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.55, clearProps: 'transform' }, '-=0.35')
        .fromTo('.hero-nav', { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5, clearProps: 'transform' }, 0.15)
    },
    { scope: rootRef },
  )

  return (
    <section ref={rootRef} className="relative isolate min-h-dvh overflow-hidden">
      <HeroBackdrop />

      <PublicHeader className="hero-nav hero-anim opacity-0" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-4.5rem)] max-w-4xl flex-col items-center justify-center px-5 pb-20 pt-8 text-center">
        <h1 className="hero-brand hero-anim text-[clamp(4rem,18vw,9rem)] font-medium leading-[0.9] tracking-[-0.06em] text-foreground opacity-0">
          {t('brand.name')}
          <span className="sr-only"> — {HOME_CONTENT[locale].h1Suffix}</span>
        </h1>

        <p className="hero-sub hero-anim mt-6 text-xl tracking-tight text-foreground/90 opacity-0 sm:text-2xl">
          {t('landing.heroSubtitle')}
        </p>

        <p className="hero-desc hero-anim mt-5 max-w-xl text-base leading-relaxed text-muted opacity-0 sm:text-lg">
          {t('landing.heroDescription')}
        </p>

        <div className="hero-cta hero-anim mt-10 flex flex-wrap items-center justify-center gap-3 opacity-0">
          <Button asChild size="lg" className="min-w-[148px]">
            <Link to="/signup">
              {t('common.getStarted')} <ArrowRight className={cn('size-4', rtlMirrorClass(i18n.language))} />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="min-w-[148px]">
            <a href="#demo">{t('landing.watchDemo')}</a>
          </Button>
          {canInstall ? (
            <Button size="lg" variant="ghost" className="min-w-[148px]" onClick={() => void install()}>
              <Download className="size-4" />
              {t('common.installApp')}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
