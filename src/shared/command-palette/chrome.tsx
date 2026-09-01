import { useEffect } from 'react'
import { Command } from 'cmdk'
import { cn } from '@/lib/utils'

export function useCommandPaletteHotkey(setOpen: (value: boolean | ((prev: boolean) => boolean)) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onCustom = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('hilm:open-command', onCustom)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('hilm:open-command', onCustom)
    }
  }, [setOpen])
}

export function CommandPaletteItem({
  label,
  icon: Icon,
  onSelect,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onSelect: () => void
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground aria-selected:bg-surface-2',
      )}
    >
      <Icon className="size-4 text-muted" />
      <span className="truncate">{label}</span>
    </Command.Item>
  )
}
