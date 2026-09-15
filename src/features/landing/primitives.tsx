import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { ensureLandingGsap, gsap, useGSAP } from '@/features/landing/gsap-setup'

ensureLandingGsap()

export function FadeIn({
  children,
  className,
  delay = 0,
  y = 28,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  y?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        gsap.set(el, { opacity: 1, y: 0 })
        return
      }

      gsap.fromTo(
        el,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: 0.85,
          delay,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 88%',
            toggleActions: 'play none none none',
          },
        },
      )
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className={cn('opacity-0', className)}>
      {children}
    </div>
  )
}

export function Section({
  id,
  children,
  className,
}: {
  id?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('relative px-5 py-20 sm:py-28', className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn('mb-12 max-w-2xl sm:mb-16', className)}>
      {eyebrow ? (
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.22em] text-muted">{eyebrow}</p>
      ) : null}
      <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {description ? <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">{description}</p> : null}
    </div>
  )
}
