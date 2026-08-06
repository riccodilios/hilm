import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Palette, Type, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type LabelMenuAction = 'edit' | 'recolor' | 'rename' | 'delete'

export function LabelContextMenu({
  open,
  x,
  y,
  onClose,
  onAction,
  canManage = true,
}: {
  open: boolean
  x: number
  y: number
  onClose: () => void
  onAction: (action: LabelMenuAction) => void
  canManage?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointer = (e: MouseEvent | PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open, onClose])

  if (!open || !canManage) return null

  const items: Array<{ id: LabelMenuAction; label: string; icon: typeof Pencil; danger?: boolean }> =
    [
      { id: 'edit', label: 'Edit Label', icon: Pencil },
      { id: 'recolor', label: 'Change Color', icon: Palette },
      { id: 'rename', label: 'Rename Label', icon: Type },
      { id: 'delete', label: 'Delete Label', icon: Trash2, danger: true },
    ]

  const maxX = typeof window !== 'undefined' ? window.innerWidth - 180 : x
  const maxY = typeof window !== 'undefined' ? window.innerHeight - 200 : y
  const left = Math.min(x, maxX)
  const top = Math.min(y, maxY)

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[80] min-w-[10.5rem] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl"
      style={{ left, top }}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-2',
              item.danger && 'text-danger',
            )}
            onClick={() => {
              onAction(item.id)
              onClose()
            }}
          >
            <Icon className="size-3.5 opacity-70" />
            {item.label}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
