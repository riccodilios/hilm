import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FadeIn, SectionHeading } from '@/features/landing/primitives'
import { ensureLandingGsap, gsap, useGSAP } from '@/features/landing/gsap-setup'

ensureLandingGsap()

export function DemoSection() {
  const { t } = useTranslation()
  const frameRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = frameRef.current
      if (!el) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      gsap.fromTo(
        el,
        { opacity: 0, y: 48, scale: 0.985 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 85%',
            toggleActions: 'play none none none',
          },
        },
      )
    },
    { scope: frameRef },
  )

  return (
    <section id="demo" className="relative scroll-mt-8 px-0 pb-16 pt-4 sm:pb-24 sm:pt-8">
      <div className="mx-auto max-w-6xl px-5">
        <FadeIn>
          <SectionHeading
            className="mb-8 sm:mb-10"
            eyebrow={t('landing.demoEyebrow')}
            title={t('landing.demoTitle')}
            description={t('landing.demoDescription')}
          />
        </FadeIn>
      </div>

      <div className="mx-auto max-w-[92rem] px-0 sm:px-5">
        <div
          ref={frameRef}
          className="overflow-hidden border-y border-border-subtle bg-black opacity-0 sm:rounded-2xl sm:border"
        >
          <video
            className="aspect-video w-full object-cover"
            src="/hilm-demo.mp4"
            controls
            playsInline
            preload="metadata"
            aria-label={t('landing.demoVideoLabel')}
          />
        </div>
      </div>
    </section>
  )
}
