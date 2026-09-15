import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LandingHero } from '@/features/landing/sections/Hero'
import { DemoSection } from '@/features/landing/sections/Demo'
import { SystemsSection } from '@/features/landing/sections/Systems'
import { ProblemSection } from '@/features/landing/sections/Problem'
import { FeaturesSection } from '@/features/landing/sections/Features'
import { WorkspaceSection } from '@/features/landing/sections/Workspace'
import { AutomationSection } from '@/features/landing/sections/Automation'
import { VoiceSection } from '@/features/landing/sections/Voice'
import { SecuritySection } from '@/features/landing/sections/Security'
import { LandingFaqSection } from '@/features/landing/sections/Faq'
import { CtaSection } from '@/features/landing/sections/Cta'
import { LandingFooter } from '@/features/landing/sections/Footer'
import { ensureLandingGsap, refreshLandingScrollTriggers } from '@/features/landing/gsap-setup'
import { useDocumentSeo } from '@/hooks/useDocumentSeo'
import {
  buildFaqJsonLd,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
  SEO,
} from '@/lib/seo'

ensureLandingGsap()

export function LandingPage() {
  const { t } = useTranslation()
  const faqItems = t('landing.faqItems', { returnObjects: true }) as Array<{ q: string; a: string }>
  const jsonLd = useMemo(
    () => [
      buildOrganizationJsonLd(),
      buildWebSiteJsonLd(),
      buildSoftwareApplicationJsonLd(),
      buildFaqJsonLd(
        (Array.isArray(faqItems) ? faqItems : []).map((item) => ({
          question: item.q,
          answer: item.a,
        })),
      ),
    ],
    [faqItems],
  )

  useDocumentSeo({
    title: SEO.title,
    description: SEO.description,
    path: '/',
    jsonLd,
  })

  useEffect(() => {
    refreshLandingScrollTriggers()
    const onLoad = () => refreshLandingScrollTriggers()
    window.addEventListener('load', onLoad)
    const fontsReady = document.fonts?.ready?.then(() => refreshLandingScrollTriggers())
    const timer = window.setTimeout(() => refreshLandingScrollTriggers(), 400)
    return () => {
      window.removeEventListener('load', onLoad)
      window.clearTimeout(timer)
      void fontsReady
    }
  }, [])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <LandingHero />
      <DemoSection />
      <SystemsSection />
      <ProblemSection />
      <FeaturesSection />
      <WorkspaceSection />
      <AutomationSection />
      <VoiceSection />
      <SecuritySection />
      <LandingFaqSection />
      <CtaSection />
      <LandingFooter />
    </div>
  )
}
