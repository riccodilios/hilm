import { useCallback, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { LabelChip } from '@/components/labels/LabelChip'
import {
  LabelContextMenu,
  type LabelMenuAction,
} from '@/components/labels/LabelContextMenu'
import { useLongPress } from '@/hooks/useLongPress'
import { cn } from '@/lib/utils'

export function ManagedLabelChip({
  id,
  name,
  color,
  className,
  selected,
  canManage = true,
  onSelect,
  onMenuAction,
  onRemove,
}: {
  id: string
  name: string
  color: string
  className?: string
  selected?: boolean
  canManage?: boolean
  onSelect?: (id: string) => void
  onMenuAction?: (action: LabelMenuAction, label: { id: string; name: string; color: string }) => void
  onRemove?: () => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const longPressed = useRef(false)

  const openMenu = useCallback(
    (event: ReactPointerEvent | ReactMouseEvent) => {
      if (!canManage || !onMenuAction) return
      event.preventDefault()
      event.stopPropagation()
      longPressed.current = true
      const clientX = 'clientX' in event ? event.clientX : 0
      const clientY = 'clientY' in event ? event.clientY : 0
      setMenu({ x: clientX, y: clientY })
    },
    [canManage, onMenuAction],
  )

  const longPress = useLongPress(openMenu)

  return (
    <>
      <button
        type="button"
        className={cn('touch-manipulation select-none', className)}
        onClick={(e) => {
          e.stopPropagation()
          if (longPressed.current) {
            longPressed.current = false
            return
          }
          onSelect?.(id)
        }}
        {...(canManage && onMenuAction
          ? {
              onPointerDown: longPress.onPointerDown,
              onPointerUp: longPress.onPointerUp,
              onPointerLeave: longPress.onPointerLeave,
              onPointerCancel: longPress.onPointerCancel,
              onContextMenu: longPress.onContextMenu,
            }
          : {})}
      >
        <LabelChip
          name={name}
          color={color}
          className={selected ? 'ring-1 ring-accent' : undefined}
          onRemove={onRemove}
        />
      </button>
      <LabelContextMenu
        open={Boolean(menu)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        canManage={canManage}
        onClose={() => setMenu(null)}
        onAction={(action) => onMenuAction?.(action, { id, name, color })}
      />
    </>
  )
}
