import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

let registered = false
let refreshScheduled = false

export function ensureLandingGsap() {
  if (registered) return
  gsap.registerPlugin(useGSAP, ScrollTrigger)
  ScrollTrigger.config({ ignoreMobileResize: true })
  registered = true
}

/** Recalculate triggers after lazy layout, fonts, or media settle. */
export function refreshLandingScrollTriggers() {
  if (refreshScheduled) return
  refreshScheduled = true
  requestAnimationFrame(() => {
    refreshScheduled = false
    ScrollTrigger.refresh()
  })
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Hide, then reveal when scrolled into view (or immediately if already visible). */
export function revealElements(
  elements: gsap.DOMTarget,
  {
    y = 24,
    duration = 0.8,
    stagger = 0,
    delay = 0,
    start = 'top 88%',
  }: {
    y?: number
    duration?: number
    stagger?: number
    delay?: number
    start?: string
  } = {},
) {
  const targets = gsap.utils.toArray<HTMLElement>(elements)
  if (!targets.length) return

  if (prefersReducedMotion()) {
    gsap.set(targets, { opacity: 1, y: 0, clearProps: 'transform' })
    return
  }

  gsap.set(targets, { opacity: 0, y })

  const play = () => {
    gsap.to(targets, {
      opacity: 1,
      y: 0,
      duration,
      stagger,
      delay,
      ease: 'power3.out',
      overwrite: 'auto',
      clearProps: 'transform',
    })
  }

  const triggerEl = targets[0]
  const alreadyVisible = ScrollTrigger.isInViewport(triggerEl, 0.15)

  if (alreadyVisible) {
    play()
    return
  }

  ScrollTrigger.create({
    trigger: triggerEl,
    start,
    once: true,
    onEnter: play,
  })
}

export { gsap, useGSAP, ScrollTrigger }
