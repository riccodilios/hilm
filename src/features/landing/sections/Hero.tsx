import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Download, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { HeroBackdrop } from '@/features/landing/HeroBackdrop'
import { usePwaInstall } from '@/hooks/usePwaInstall'

export function LandingHero() {
  const reduce = useReducedMotion()
  const { canInstall, install } = usePwaInstall()
  const { t } = useTranslation()

  return (
    <section className="relative isolate min-h-dvh overflow-hidden">
      <HeroBackdrop />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <span className="text-sm font-medium tracking-tight text-foreground">{t('brand.name')}</span>
        <div className="flex items-center gap-2">
          <LanguageSwitcher compact />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/login">{t('common.signIn')}</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/signup">{t('common.getStarted')}</Link>
          </Button>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-4.5rem)] max-w-4xl flex-col items-center justify-center px-5 pb-24 pt-10 text-center">
        <motion.h1
          className="text-[clamp(4rem,18vw,9rem)] font-medium leading-[0.9] tracking-[-0.06em] text-foreground"
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          {t('brand.name')}
        </motion.h1>

        <motion.p
          className="mt-6 text-xl tracking-tight text-foreground/90 sm:text-2xl"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          {t('landing.heroSubtitle')}
        </motion.p>

        <motion.p
          className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {t('landing.heroDescription')}
        </motion.p>

        <motion.div
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <Button asChild size="lg" className="min-w-[148px]">
            <Link to="/signup">
              {t('common.getStarted')} <ArrowRight className="size-4" />
            </Link>
          </Button>
          {canInstall ? (
            <Button size="lg" variant="secondary" className="min-w-[148px]" onClick={() => void install()}>
              <Download className="size-4" />
              {t('common.installApp')}
            </Button>
          ) : null}
        </motion.div>
      </div>
    </section>
  )
}
