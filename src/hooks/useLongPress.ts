import { useCallback, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

type LongPressHandlers = {
  onPointerDown: (event: ReactPointerEvent) => void
  onPointerUp: (event: ReactPointerEvent) => void
  onPointerLeave: (event: ReactPointerEvent) => void
  onPointerCancel: (event: ReactPointerEvent) => void
  onContextMenu: (event: ReactMouseEvent) => void
}

export function useLongPress(
  onLongPress: (event: ReactPointerEvent | ReactMouseEvent) => void,
  opts?: { delayMs?: number; moveThreshold?: number },
): LongPressHandlers {
  const delayMs = opts?.delayMs ?? 480
  const moveThreshold = opts?.moveThreshold ?? 10
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clear = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    start.current = null
  }, [])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      fired.current = false
      start.current = { x: event.clientX, y: event.clientY }
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLongPress(event)
        clear()
      }, delayMs)
    },
    [clear, delayMs, onLongPress],
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      if (fired.current) {
        event.preventDefault()
        event.stopPropagation()
      }
      clear()
    },
    [clear],
  )

  const onPointerLeave = useCallback(
    (event: ReactPointerEvent) => {
      if (!start.current) return
      const dx = Math.abs(event.clientX - start.current.x)
      const dy = Math.abs(event.clientY - start.current.y)
      if (dx > moveThreshold || dy > moveThreshold) clear()
    },
    [clear, moveThreshold],
  )

  const onPointerCancel = useCallback(() => {
    clear()
  }, [clear])

  const onContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()
      onLongPress(event)
    },
    [onLongPress],
  )

  return {
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
    onContextMenu,
  }
}
