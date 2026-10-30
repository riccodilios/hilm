import { useEffect } from 'react'
import { LandingHero } from '@/features/landing/sections/Hero'
import { DemoSection } from '@/features/landing/sections/Demo'
import { SystemsSection } from '@/features/landing/sections/Systems'
import { ProblemSection } from '@/features/landing/sections/Problem'
import { FeaturesSection } from '@/features/landing/sections/Features'
import { WorkspaceSection } from '@/features/landing/sections/Workspace'
import { MeetingsSection } from '@/features/landing/sections/Meetings'
import { AutomationSection } from '@/features/landing/sections/Automation'
import { VoiceSection } from '@/features/landing/sections/Voice'
import { SecuritySection } from '@/features/landing/sections/Security'
import { LandingFaqSection } from '@/features/landing/sections/Faq'
import { CtaSection } from '@/features/landing/sections/Cta'
import { PublicFooter } from '@/features/landing/public/PublicChrome'
import { usePublicPage } from '@/features/landing/public/PublicPage'
import { ensureLandingGsap, refreshLandingScrollTriggers } from '@/features/landing/gsap-setup'
import { usePublicPageSeo } from '@/hooks/useDocumentSeo'

ensureLandingGsap()

export function LandingPage() {
  const { locale } = usePublicPage()
  usePublicPageSeo('home', locale)

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
      <main>
        <DemoSection />
        <SystemsSection />
        <ProblemSection />
        <FeaturesSection />
        <WorkspaceSection />
        <MeetingsSection />
        <AutomationSection />
        <VoiceSection />
        <SecuritySection />
        <LandingFaqSection />
        <CtaSection />
      </main>
      <PublicFooter />
    </div>
  )
}
