import { lazy, Suspense } from 'react'
import { LandingHero } from '@/features/landing/sections/Hero'
import { LandingFooter } from '@/features/landing/sections/Footer'
import { SectionSkeleton } from '@/features/landing/LandingSkeleton'

const ProblemSection = lazy(() =>
  import('@/features/landing/sections/Problem').then((m) => ({ default: m.ProblemSection })),
)
const FeaturesSection = lazy(() =>
  import('@/features/landing/sections/Features').then((m) => ({ default: m.FeaturesSection })),
)
const AutomationSection = lazy(() =>
  import('@/features/landing/sections/Automation').then((m) => ({ default: m.AutomationSection })),
)
const VoiceSection = lazy(() =>
  import('@/features/landing/sections/Voice').then((m) => ({ default: m.VoiceSection })),
)
const SecuritySection = lazy(() =>
  import('@/features/landing/sections/Security').then((m) => ({ default: m.SecuritySection })),
)
const CtaSection = lazy(() =>
  import('@/features/landing/sections/Cta').then((m) => ({ default: m.CtaSection })),
)

function LazyBlock({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<SectionSkeleton />}>{children}</Suspense>
}

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <LandingHero />
      <LazyBlock>
        <ProblemSection />
      </LazyBlock>
      <LazyBlock>
        <FeaturesSection />
      </LazyBlock>
      <LazyBlock>
        <AutomationSection />
      </LazyBlock>
      <LazyBlock>
        <VoiceSection />
      </LazyBlock>
      <LazyBlock>
        <SecuritySection />
      </LazyBlock>
      <LazyBlock>
        <CtaSection />
      </LazyBlock>
      <LandingFooter />
    </div>
  )
}
