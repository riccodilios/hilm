import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { useLongPress } from '@/hooks/useLongPress'
import { cn, formatRelative } from '@/lib/utils'
import type { Tables } from '@/types/database'

export function NoteCard({
  note,
  onOpenMenu,
  showUpdated = true,
  className,
}: {
  note: Tables<'notes'>
  onOpenMenu: (note: Tables<'notes'>) => void
  showUpdated?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const suppressClick = useRef(false)
  const longPress = useLongPress(() => {
    suppressClick.current = true
    navigator.vibrate?.(10)
    onOpenMenu(note)
  })

  return (
    <div
      {...longPress}
      onClickCapture={(event) => {
        if (!suppressClick.current) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      className={cn(
        'group relative min-w-0 select-none touch-manipulation rounded-2xl border border-border-subtle bg-surface/70 p-4 transition hover:border-border hover:bg-surface [-webkit-touch-callout:none] sm:p-5',
        className,
      )}
    >
      <Link
        to={`/personal/notes/${note.id}`}
        draggable={false}
        onPointerDown={() => {
          suppressClick.current = false
        }}
        className="absolute inset-0 rounded-[inherit]"
        aria-label={note.title}
      />
      <div className="relative pointer-events-none">
        <FileText className="mb-4 size-5 text-accent sm:mb-5" />
        <h2 className="break-words font-medium">{note.title}</h2>
        <p className="mt-2 line-clamp-2 break-words text-sm text-muted">
          {note.body || t('notes.empty')}
        </p>
        {showUpdated ? (
          <p className="mt-4 text-xs text-muted">
            {t('notes.updated', { time: formatRelative(note.updated_at) })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
