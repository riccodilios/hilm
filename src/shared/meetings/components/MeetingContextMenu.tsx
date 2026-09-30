import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FolderInput, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type MeetingMenuAction = 'edit' | 'move' | 'delete'

export const MEETING_MENU_WIDTH = 208

export function MeetingContextMenu({
  position,
  actions,
  onClose,
  onAction,
}: {
  position: { x: number; y: number } | null
  actions: MeetingMenuAction[]
  onClose: () => void
  onAction: (action: MeetingMenuAction) => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const open = Boolean(position) && actions.length > 0

  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onScroll = () => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, onClose])

  if (!open || !position) return null

  const items: Record<MeetingMenuAction, { label: string; icon: typeof Pencil; danger?: boolean }> = {
    edit: { label: t('meetings.menu.edit'), icon: Pencil },
    move: { label: t('meetings.menu.move'), icon: FolderInput },
    delete: { label: t('meetings.delete.button'), icon: Trash2, danger: true },
  }
  const width = MEETING_MENU_WIDTH
  const left = Math.max(8, Math.min(position.x, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(position.y, window.innerHeight - actions.length * 40 - 16))

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[80] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl"
      style={{ left, top, width }}
    >
      {actions.map((action) => {
        const item = items[action]
        const Icon = item.icon
        return (
          <button
            key={action}
            type="button"
            role="menuitem"
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-sm outline-none hover:bg-surface-2 focus-visible:bg-surface-2',
              item.danger && 'text-danger',
            )}
            onClick={() => {
              onClose()
              onAction(action)
            }}
          >
            <Icon className="size-4 opacity-70" />
            {item.label}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
