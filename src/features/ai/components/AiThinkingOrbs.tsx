import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export type ThinkingOrbState =
  | 'idle'
  | 'thinking'
  | 'planning'
  | 'executing'
  | 'finalizing'
  | 'complete'
  | 'error'

type OrbConfig = {
  dots: number
  radius: number
  speed: number
  wobble: number
  sizeMin: number
  sizeMax: number
}

const CONFIG: Record<ThinkingOrbState, OrbConfig> = {
  idle: { dots: 28, radius: 0.34, speed: 0.22, wobble: 0.012, sizeMin: 0.9, sizeMax: 1.5 },
  thinking: { dots: 42, radius: 0.38, speed: 0.55, wobble: 0.03, sizeMin: 1, sizeMax: 1.9 },
  planning: { dots: 48, radius: 0.4, speed: 0.7, wobble: 0.04, sizeMin: 1, sizeMax: 2.1 },
  executing: { dots: 56, radius: 0.42, speed: 1.05, wobble: 0.055, sizeMin: 1.1, sizeMax: 2.35 },
  finalizing: { dots: 36, radius: 0.36, speed: 0.35, wobble: 0.018, sizeMin: 1, sizeMax: 1.7 },
  complete: { dots: 24, radius: 0.32, speed: 0.15, wobble: 0.008, sizeMin: 0.9, sizeMax: 1.4 },
  error: { dots: 32, radius: 0.36, speed: 0.2, wobble: 0.01, sizeMin: 1, sizeMax: 1.6 },
}

function fibSphere(count: number) {
  const pts: Array<{ x: number; y: number; z: number }> = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2
    const radius = Math.sqrt(1 - y * y)
    const theta = golden * i
    pts.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius })
  }
  return pts
}

function resolveInk(theme: 'auto' | 'dark' | 'light'): { r: number; g: number; b: number } {
  if (theme === 'dark') return { r: 245, g: 245, b: 247 }
  if (theme === 'light') return { r: 18, g: 18, b: 20 }
  const root = document.documentElement
  const dark =
    root.classList.contains('dark') ||
    root.dataset.theme === 'dark' ||
    (!root.classList.contains('light') &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? { r: 245, g: 245, b: 247 } : { r: 18, g: 18, b: 20 }
}

function resolveErrorInk(theme: 'auto' | 'dark' | 'light'): { r: number; g: number; b: number } {
  if (theme === 'light') return { r: 160, g: 40, b: 40 }
  return { r: 248, g: 180, b: 180 }
}

export function AiThinkingOrbs({
  state = 'thinking',
  size = 64,
  speed = 1,
  paused = false,
  theme = 'auto',
  className,
  label,
}: {
  state?: ThinkingOrbState
  size?: 20 | 28 | 40 | 64 | number
  speed?: number
  paused?: boolean
  theme?: 'auto' | 'dark' | 'light'
  className?: string
  label?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const speedRef = useRef(speed)
  const pausedRef = useRef(paused)
  const themeRef = useRef(theme)
  const visibleRef = useRef(true)

  stateRef.current = state
  speedRef.current = speed
  pausedRef.current = paused
  themeRef.current = theme

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let t = 0
    let last = performance.now()

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const css = size
    canvas.width = css * dpr
    canvas.height = css * dpr
    canvas.style.width = `${css}px`
    canvas.style.height = `${css}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = Boolean(entry?.isIntersecting)
      },
      { threshold: 0.05 },
    )
    io.observe(canvas)

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') visibleRef.current = false
    }
    document.addEventListener('visibilitychange', onVisibility)

    const drawFrame = (time: number, staticFrame = false) => {
      const cfg = CONFIG[stateRef.current]
      const pts = fibSphere(cfg.dots)
      const ink =
        stateRef.current === 'error'
          ? resolveErrorInk(themeRef.current)
          : resolveInk(themeRef.current)
      const cx = css / 2
      const cy = css / 2
      const R = css * cfg.radius

      ctx.clearRect(0, 0, css, css)

      const rotY = time * cfg.speed * speedRef.current * 0.0012
      const rotX = time * cfg.speed * speedRef.current * 0.0007

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!
        let x = p.x
        let y = p.y
        let z = p.z
        const cosY = Math.cos(rotY)
        const sinY = Math.sin(rotY)
        const cosX = Math.cos(rotX)
        const sinX = Math.sin(rotX)
        const xz = x * cosY - z * sinY
        z = x * sinY + z * cosY
        x = xz
        const yz = y * cosX - z * sinX
        z = y * sinX + z * cosX
        y = yz

        const wobble = staticFrame
          ? 0
          : Math.sin(time * 0.003 * cfg.speed + i * 0.7) * cfg.wobble * css
        const depth = (z + 1) * 0.5
        const alpha = 0.22 + depth * 0.78
        const dot = cfg.sizeMin + depth * (cfg.sizeMax - cfg.sizeMin)

        ctx.beginPath()
        ctx.fillStyle = `rgba(${ink.r},${ink.g},${ink.b},${alpha.toFixed(3)})`
        ctx.arc(cx + x * R + wobble * 0.35, cy + y * R + wobble * 0.2, dot, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    if (reduce) {
      drawFrame(0, true)
      return () => {
        io.disconnect()
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }

    const tick = (now: number) => {
      const dt = Math.min(32, now - last)
      last = now
      if (!pausedRef.current && visibleRef.current && document.visibilityState === 'visible') {
        t += dt
        drawFrame(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [size])

  const aria =
    label ??
    ({
      idle: 'Hilm idle',
      thinking: 'Hilm is thinking',
      planning: 'Hilm is planning',
      executing: 'Hilm is executing actions',
      finalizing: 'Hilm is finalizing',
      complete: 'Hilm finished',
      error: 'Hilm encountered an error',
    }[state] as string)

  return (
    <canvas
      ref={canvasRef}
      className={cn('block shrink-0', className)}
      role="img"
      aria-label={aria}
    />
  )
}
