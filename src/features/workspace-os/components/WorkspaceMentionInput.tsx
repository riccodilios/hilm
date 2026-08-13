import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type MentionMember = {
  id: string
  label: string
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Convert stored @{uuid} tokens into @Label for editing/display. */
export function tokensToDisplay(content: string, members: MentionMember[]) {
  const map = new Map(members.map((m) => [m.id.toLowerCase(), m.label]))
  return content.replace(/@\{([0-9a-f-]{36})\}/gi, (_, id: string) => {
    const label = map.get(id.toLowerCase())
    return label ? `@${label}` : '@member'
  })
}

/** Convert @Label display text into @{uuid} tokens using workspace members. */
export function displayToTokens(display: string, members: MentionMember[]) {
  let result = display
  const sorted = [...members].sort((a, b) => b.label.length - a.label.length)
  for (const member of sorted) {
    const re = new RegExp(`@${escapeRegExp(member.label)}(?=$|\\s|[.,!?;:])`, 'g')
    result = result.replace(re, `@{${member.id}}`)
  }
  return result
}

/**
 * Workspace comment composer with @mention autocomplete.
 * Textarea shows @Name; callers should persist via displayToTokens().
 */
export function WorkspaceMentionInput({
  value,
  onChange,
  members,
  placeholder = 'Write a comment… Use @ to mention someone',
  disabled,
  autoFocus,
  onSubmit,
}: {
  value: string
  onChange: (next: string) => void
  members: MentionMember[]
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  onSubmit?: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [mentionStart, setMentionStart] = useState<number | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = !q
      ? members
      : members.filter((m) => m.label.toLowerCase().includes(q))
    return list.slice(0, 8)
  }, [members, query])

  function detectMention(text: string, caret: number) {
    const before = text.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at < 0) return null
    if (at > 0 && !/\s/.test(before[at - 1]!)) return null
    const fragment = before.slice(at + 1)
    if (/\s/.test(fragment)) return null
    return { start: at, query: fragment }
  }

  function handleChange(next: string, caret: number) {
    onChange(next)
    const mention = detectMention(next, caret)
    if (mention) {
      setOpen(true)
      setQuery(mention.query)
      setMentionStart(mention.start)
      setActiveIndex(0)
    } else {
      setOpen(false)
      setQuery('')
      setMentionStart(null)
    }
  }

  function insertMention(member: MentionMember) {
    const el = textareaRef.current
    if (!el || mentionStart == null) return
    const caret = el.selectionStart
    const before = value.slice(0, mentionStart)
    const after = value.slice(caret)
    const token = `@${member.label}`
    const next = `${before}${token}${after}`
    onChange(next)
    setOpen(false)
    setQuery('')
    setMentionStart(null)
    requestAnimationFrame(() => {
      const pos = before.length + token.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
  }, [query, open])

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-sm outline-none ring-0 placeholder:text-muted-fg focus:border-border"
        onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (open && filtered.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIndex((i) => (i + 1) % filtered.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              insertMention(filtered[activeIndex]!)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setOpen(false)
              return
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
      {open && filtered.length ? (
        <ul
          className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-full max-w-sm overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1 shadow-xl"
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.map((member, index) => (
            <li key={member.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm',
                  index === activeIndex ? 'bg-surface-2' : 'hover:bg-surface-2/70',
                )}
                onClick={() => insertMention(member)}
              >
                @{member.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
