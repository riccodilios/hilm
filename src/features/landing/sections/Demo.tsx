import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureLandingGsap, gsap, useGSAP } from '@/features/landing/gsap-setup'

ensureLandingGsap()

export function DemoSection() {
  const { t } = useTranslation()
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const root = sectionRef.current
      if (!root) return

      const copy = root.querySelectorAll('.demo-copy > *')
      const video = root.querySelector('.demo-video')
      if (!copy.length || !video) return

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.set([copy, video], { clearProps: 'all' })
        return
      }

      gsap
        .timeline({
          scrollTrigger: {
            trigger: root,
            start: 'top 82%',
            toggleActions: 'play none none none',
          },
        })
        .from(copy, {
          opacity: 0,
          y: 22,
          duration: 0.7,
          stagger: 0.08,
          ease: 'power3.out',
        })
        .from(
          video,
          {
            opacity: 0,
            y: 18,
            duration: 0.8,
            ease: 'power3.out',
          },
          '-=0.45',
        )
    },
    { scope: sectionRef },
  )

  return (
    <section id="demo" ref={sectionRef} className="relative scroll-mt-8 px-5 py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="demo-copy">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.22em] text-muted">
            {t('landing.demoEyebrow')}
          </p>
          <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            {t('landing.demoTitle')}
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted sm:text-lg">
            {t('landing.demoDescription')}
          </p>
        </div>

        <div className="demo-video overflow-hidden rounded-2xl border border-border-subtle bg-surface-2 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.65)]">
          <video
            className="aspect-video w-full bg-surface-2 object-contain"
            src="/hilm-demo.mp4"
            controls
            playsInline
            preload="auto"
            controlsList="nodownload"
            aria-label={t('landing.demoVideoLabel')}
          >
            <source src="/hilm-demo.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
    </section>
  )
}
