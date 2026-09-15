import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  ensureLandingGsap,
  refreshLandingScrollTriggers,
  revealElements,
  useGSAP,
} from '@/features/landing/gsap-setup'

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
      revealElements(el, { y, delay, start: 'top 90%' })
      refreshLandingScrollTriggers()
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className={cn('opacity-0 will-change-transform', className)}>
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
  const ref = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    refreshLandingScrollTriggers()
  }, [])

  return (
    <section id={id} ref={ref} className={cn('relative px-5 py-20 sm:py-28', className)}>
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
