import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

type GhostPos = { x: number; y: number }

type DragOpts = {
  onDragEnd: (taskId: string, clientX: number, clientY: number) => void
  onDragMove?: (taskId: string, clientX: number, clientY: number) => void
  resolveHoverKey?: (clientX: number, clientY: number) => string | null
  disabled?: boolean
  /** Touch/pen hold before drag starts (ms). */
  activateDelayMs?: number
}

type Session = {
  taskId: string
  pointerId: number
  startX: number
  startY: number
  pointerType: string
  activated: boolean
  timer: number | null
  target: HTMLElement | null
}

type WindowListeners = {
  onMove: (ev: PointerEvent) => void
  onUp: (ev: PointerEvent) => void
  onTouchMove?: (ev: TouchEvent) => void
}

/**
 * Hold-to-drag for Mission Control (calendar + timeline).
 * Pre-activation stays passive so the timeline can scroll; scroll is only locked after drag starts.
 */
export function useMissionPointerDrag(opts: DragOpts) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [ghost, setGhost] = useState<GhostPos | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const didDragRef = useRef(false)
  const sessionRef = useRef<Session | null>(null)
  const pendingListenersRef = useRef<WindowListeners | null>(null)
  const activeListenersRef = useRef<WindowListeners | null>(null)

  const clearBodyLock = useCallback(() => {
    document.body.style.userSelect = ''
    document.body.style.touchAction = ''
    document.documentElement.style.overflow = ''
  }, [])

  const detachListeners = useCallback((bucket: 'pending' | 'active') => {
    const ref = bucket === 'pending' ? pendingListenersRef : activeListenersRef
    const listeners = ref.current
    if (!listeners) return
    window.removeEventListener('pointermove', listeners.onMove)
    window.removeEventListener('pointerup', listeners.onUp)
    window.removeEventListener('pointercancel', listeners.onUp)
    if (listeners.onTouchMove) {
      window.removeEventListener('touchmove', listeners.onTouchMove)
    }
    ref.current = null
  }, [])

  const cleanup = useCallback(() => {
    const session = sessionRef.current
    if (session?.timer != null) window.clearTimeout(session.timer)
    if (session?.target) {
      try {
        if (session.target.hasPointerCapture?.(session.pointerId)) {
          session.target.releasePointerCapture(session.pointerId)
        }
      } catch {
        /* ignore */
      }
      session.target.style.pointerEvents = ''
      session.target.style.touchAction = ''
    }
    sessionRef.current = null
    detachListeners('pending')
    detachListeners('active')
    setActiveTaskId(null)
    setGhost(null)
    setHoverKey(null)
    clearBodyLock()
  }, [clearBodyLock, detachListeners])

  const attachActiveListeners = useCallback(() => {
    if (activeListenersRef.current) return

    const listeners: WindowListeners = {
      onMove: (ev: PointerEvent) => {
        const session = sessionRef.current
        if (!session?.activated || ev.pointerId !== session.pointerId) return
        ev.preventDefault()
        setGhost({ x: ev.clientX, y: ev.clientY })
        const resolve = optsRef.current.resolveHoverKey
        if (resolve) setHoverKey(resolve(ev.clientX, ev.clientY))
        optsRef.current.onDragMove?.(session.taskId, ev.clientX, ev.clientY)
      },
      onTouchMove: (ev: TouchEvent) => {
        const session = sessionRef.current
        if (!session?.activated) return
        if (ev.cancelable) ev.preventDefault()
      },
      onUp: (ev: PointerEvent) => {
        const session = sessionRef.current
        if (!session || ev.pointerId !== session.pointerId) return
        const activated = session.activated
        const id = session.taskId
        const x = ev.clientX
        const y = ev.clientY
        cleanup()
        if (activated) {
          optsRef.current.onDragEnd(id, x, y)
        }
      },
    }

    activeListenersRef.current = listeners
    window.addEventListener('pointermove', listeners.onMove, { passive: false })
    window.addEventListener('pointerup', listeners.onUp)
    window.addEventListener('pointercancel', listeners.onUp)
    window.addEventListener('touchmove', listeners.onTouchMove!, { passive: false })
  }, [cleanup])

  const activate = useCallback(
    (taskId: string, clientX: number, clientY: number) => {
      const session = sessionRef.current
      if (!session || session.activated) return
      session.activated = true
      if (session.timer != null) {
        window.clearTimeout(session.timer)
        session.timer = null
      }
      // Drop passive watchers; active drag owns the gesture from here.
      detachListeners('pending')
      didDragRef.current = true
      setActiveTaskId(taskId)
      setGhost({ x: clientX, y: clientY })
      document.body.style.userSelect = 'none'
      document.body.style.touchAction = 'none'
      document.documentElement.style.overflow = 'hidden'
      if (session.target) {
        session.target.style.pointerEvents = 'none'
        session.target.style.touchAction = 'none'
        try {
          session.target.setPointerCapture(session.pointerId)
        } catch {
          /* ignore */
        }
      }
      attachActiveListeners()
      const resolve = optsRef.current.resolveHoverKey
      if (resolve) setHoverKey(resolve(clientX, clientY))
      optsRef.current.onDragMove?.(taskId, clientX, clientY)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(14)
        } catch {
          /* ignore */
        }
      }
    },
    [attachActiveListeners, detachListeners],
  )

  const bindTask = useCallback(
    (taskId: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (optsRef.current.disabled) return
        if (event.button !== 0 && event.pointerType === 'mouse') return
        if (sessionRef.current) return

        didDragRef.current = false
        const pointerType = event.pointerType || 'mouse'
        const isTouch = pointerType === 'touch' || pointerType === 'pen'
        const startX = event.clientX
        const startY = event.clientY
        const delay = optsRef.current.activateDelayMs ?? (isTouch ? 280 : 0)
        const target = event.currentTarget

        // Allow vertical timeline/page scroll until a real drag starts.
        target.style.touchAction = 'pan-y'

        const timer =
          delay > 0
            ? window.setTimeout(() => activate(taskId, startX, startY), delay)
            : null

        sessionRef.current = {
          taskId,
          pointerId: event.pointerId,
          startX,
          startY,
          pointerType,
          activated: false,
          timer,
          target,
        }

        if (delay === 0) {
          activate(taskId, startX, startY)
          return
        }

        // Passive pre-activation watchers only — non-passive touchmove would block scroll.
        const listeners: WindowListeners = {
          onMove: (ev: PointerEvent) => {
            const session = sessionRef.current
            if (!session || ev.pointerId !== session.pointerId || session.activated) return
            const dx = Math.abs(ev.clientX - session.startX)
            const dy = Math.abs(ev.clientY - session.startY)
            if (dx > 14 || dy > 14) cleanup()
          },
          onUp: (ev: PointerEvent) => {
            const session = sessionRef.current
            if (!session || ev.pointerId !== session.pointerId || session.activated) return
            cleanup()
          },
        }

        pendingListenersRef.current = listeners
        window.addEventListener('pointermove', listeners.onMove, { passive: true })
        window.addEventListener('pointerup', listeners.onUp)
        window.addEventListener('pointercancel', listeners.onUp)
      },
      onClickCapture: (event: React.MouseEvent) => {
        if (!didDragRef.current) return
        event.preventDefault()
        event.stopPropagation()
        window.setTimeout(() => {
          didDragRef.current = false
        }, 0)
      },
    }),
    [activate, cleanup],
  )

  return {
    activeTaskId,
    ghost,
    hoverKey,
    setHoverKey,
    bindTask,
    isDragging: Boolean(activeTaskId),
    suppressClick: () => didDragRef.current,
  }
}

/** Prefer elementsFromPoint so the dragged chip / ghost does not block hit targets. */
export function elementDayKeyAtPoint(clientX: number, clientY: number) {
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean)
  for (const node of stack) {
    if (!(node instanceof Element)) continue
    const day = node.closest('[data-mission-day]')
    if (day) return day.getAttribute('data-mission-day')
  }
  return null
}

export function timelineMetricsAtPoint(clientX: number, clientY: number) {
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean)

  let root: HTMLElement | null = null
  for (const node of stack) {
    if (!(node instanceof Element)) continue
    const hit = node.closest('[data-mission-timeline]') as HTMLElement | null
    if (hit) {
      root = hit
      break
    }
  }
  if (!root) {
    root = document.querySelector('[data-mission-timeline]') as HTMLElement | null
  }
  if (!root) return null
  const rect = root.getBoundingClientRect()
  const y = clientY - rect.top + root.scrollTop - 8
  return { root, y, clientX, clientY }
}
