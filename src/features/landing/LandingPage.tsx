import { lazy, Suspense, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LandingHero } from '@/features/landing/sections/Hero'
import { LandingFooter } from '@/features/landing/sections/Footer'
import { SectionSkeleton } from '@/features/landing/LandingSkeleton'
import { useDocumentSeo } from '@/hooks/useDocumentSeo'
import {
  buildFaqJsonLd,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
  SEO,
} from '@/lib/seo'

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
const FaqSection = lazy(() =>
  import('@/features/landing/sections/Faq').then((m) => ({ default: m.LandingFaqSection })),
)
const CtaSection = lazy(() =>
  import('@/features/landing/sections/Cta').then((m) => ({ default: m.CtaSection })),
)

function LazyBlock({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<SectionSkeleton />}>{children}</Suspense>
}

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
        <FaqSection />
      </LazyBlock>
      <LazyBlock>
        <CtaSection />
      </LazyBlock>
      <LandingFooter />
    </div>
  )
}
