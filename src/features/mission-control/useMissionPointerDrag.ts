import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

type GhostPos = { x: number; y: number }

type DragOpts = {
  onDragEnd: (taskId: string, clientX: number, clientY: number) => void
  onDragMove?: (taskId: string, clientX: number, clientY: number) => void
  resolveHoverKey?: (clientX: number, clientY: number) => string | null
  disabled?: boolean
}

/**
 * Touch- and mouse-friendly mission task drag.
 * Touch: short hold then move (won't fight scroll).
 * Mouse: small movement activates (HTML5 DnD alternative).
 */
export function useMissionPointerDrag(opts: DragOpts) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [ghost, setGhost] = useState<GhostPos | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const didDragRef = useRef(false)
  const sessionRef = useRef<{
    taskId: string
    pointerId: number
    startX: number
    startY: number
    pointerType: string
    activated: boolean
    timer: number | null
  } | null>(null)

  const cleanup = useCallback(() => {
    const session = sessionRef.current
    if (session?.timer != null) window.clearTimeout(session.timer)
    sessionRef.current = null
    setActiveTaskId(null)
    setGhost(null)
    setHoverKey(null)
    document.body.style.userSelect = ''
    document.body.style.touchAction = ''
  }, [])

  const activate = useCallback((taskId: string, clientX: number, clientY: number) => {
    const session = sessionRef.current
    if (!session || session.activated) return
    session.activated = true
    didDragRef.current = true
    setActiveTaskId(taskId)
    setGhost({ x: clientX, y: clientY })
    document.body.style.userSelect = 'none'
    document.body.style.touchAction = 'none'
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(12)
      } catch {
        /* ignore */
      }
    }
  }, [])

  const bindTask = useCallback(
    (taskId: string) => ({
      onPointerDown: (event: ReactPointerEvent) => {
        if (optsRef.current.disabled) return
        if (event.button !== 0 && event.pointerType === 'mouse') return
        if (sessionRef.current) return

        didDragRef.current = false
        const pointerType = event.pointerType
        const startX = event.clientX
        const startY = event.clientY
        const delay = pointerType === 'touch' || pointerType === 'pen' ? 220 : 0

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
        }

        const onMove = (ev: PointerEvent) => {
          const session = sessionRef.current
          if (!session || ev.pointerId !== session.pointerId) return
          const dx = Math.abs(ev.clientX - session.startX)
          const dy = Math.abs(ev.clientY - session.startY)

          if (!session.activated) {
            if (session.pointerType === 'touch' || session.pointerType === 'pen') {
              if (dx > 10 || dy > 10) cleanup()
              return
            }
            if (dx > 6 || dy > 6) {
              if (session.timer != null) window.clearTimeout(session.timer)
              session.timer = null
              activate(taskId, ev.clientX, ev.clientY)
            }
            return
          }

          ev.preventDefault()
          setGhost({ x: ev.clientX, y: ev.clientY })
          const resolve = optsRef.current.resolveHoverKey
          if (resolve) setHoverKey(resolve(ev.clientX, ev.clientY))
          optsRef.current.onDragMove?.(taskId, ev.clientX, ev.clientY)
        }

        const onUp = (ev: PointerEvent) => {
          const session = sessionRef.current
          if (!session || ev.pointerId !== session.pointerId) return
          const activated = session.activated
          const id = session.taskId
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          cleanup()
          if (activated) {
            optsRef.current.onDragEnd(id, ev.clientX, ev.clientY)
          }
        }

        window.addEventListener('pointermove', onMove, { passive: false })
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      },
      onClickCapture: (event: React.MouseEvent) => {
        if (!didDragRef.current) return
        event.preventDefault()
        event.stopPropagation()
        didDragRef.current = false
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
  }
}

export function elementDayKeyAtPoint(clientX: number, clientY: number) {
  const el = document.elementFromPoint(clientX, clientY)
  return el?.closest('[data-mission-day]')?.getAttribute('data-mission-day') ?? null
}

export function timelineHourAtPoint(clientX: number, clientY: number) {
  const el = document.elementFromPoint(clientX, clientY)
  const root = el?.closest('[data-mission-timeline]') as HTMLElement | null
  if (!root) return null
  const rect = root.getBoundingClientRect()
  const y = clientY - rect.top + root.scrollTop - 8
  return { root, y }
}
