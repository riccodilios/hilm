import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ensureLandingGsap,
  refreshLandingScrollTriggers,
  revealElements,
  useGSAP,
} from '@/features/landing/gsap-setup'

ensureLandingGsap()

export function DemoSection() {
  const { t } = useTranslation()
  const sectionRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useGSAP(
    () => {
      const root = sectionRef.current
      if (!root) return

      const copy = root.querySelectorAll('.demo-copy > *')
      const video = root.querySelector('.demo-video')
      if (!copy.length || !video) return

      revealElements(copy, { y: 22, stagger: 0.08, start: 'top 90%' })
      revealElements(video, { y: 18, delay: 0.12, start: 'top 90%' })
      refreshLandingScrollTriggers()
    },
    { scope: sectionRef },
  )

  // The 9 MB demo loads only when its section approaches the viewport, not with the page.
  const [nearViewport, setNearViewport] = useState(false)
  useEffect(() => {
    const section = sectionRef.current
    if (!section || nearViewport) return
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true)
      },
      { rootMargin: '300px 0px' },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [nearViewport])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !nearViewport) return

    video.muted = true
    video.defaultMuted = true
    video.playsInline = true

    const tryPlay = () => {
      void video.play().catch(() => {
        /* Autoplay can still be blocked; controls remain available. */
      })
    }

    tryPlay()
    video.addEventListener('loadeddata', tryPlay)
    video.addEventListener('canplay', tryPlay)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') tryPlay()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      video.removeEventListener('loadeddata', tryPlay)
      video.removeEventListener('canplay', tryPlay)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [nearViewport])

  return (
    <section id="demo" ref={sectionRef} className="relative scroll-mt-8 px-5 py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="demo-copy [&>*]:opacity-0">
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

        <div className="demo-video opacity-0 overflow-hidden rounded-2xl border border-border-subtle bg-surface-2 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.65)]">
          <video
            ref={videoRef}
            className="aspect-video w-full bg-surface-2 object-contain"
            src={nearViewport ? '/hilm-demo.mp4' : undefined}
            autoPlay={nearViewport}
            muted
            loop
            playsInline
            controls
            preload={nearViewport ? 'auto' : 'none'}
            controlsList="nodownload"
            aria-label={t('landing.demoVideoLabel')}
          />
        </div>
      </div>
    </section>
  )
}
