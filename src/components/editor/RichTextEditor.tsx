import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  List,
  ListOrdered,
  ListChecks,
  Link2,
  Code,
  Quote,
  Table as TableIcon,
  Unlink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type MentionOption = { id: string; label: string }

function normalizeUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = new URL(withProtocol)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder = 'Write…',
  className,
  editable = true,
  mentions: _mentions = [],
}: {
  value: string
  onChange: (html: string) => void
  onBlur?: (html: string) => void
  placeholder?: string
  className?: string
  editable?: boolean
  mentions?: MentionOption[]
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
      }),
      Underline,
      Link.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          class: 'rte-link',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Placeholder.configure({ placeholder }),
      TaskList.configure({
        HTMLAttributes: { class: 'rte-task-list' },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: { class: 'rte-task-item' },
      }),
      Table.configure({
        resizable: false,
        HTMLAttributes: { class: 'rte-table' },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: { class: 'rte-th' },
      }),
      TableCell.configure({
        HTMLAttributes: { class: 'rte-td' },
      }),
    ],
    content: value || '',
    editable,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    onBlur: ({ editor: ed }) => onBlur?.(ed.getHTML()),
    editorProps: {
      attributes: {
        class: 'rte-content prose prose-invert max-w-none min-h-[140px] focus:outline-none',
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const next = value || ''
    if (next !== current && next !== '<p></p>') {
      editor.commands.setContent(next)
    }
  }, [value, editor])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  if (!editor) return null

  const tool = (
    action: () => void,
    active: boolean,
    label: string,
    icon: ReactNode,
  ) => (
    <Button
      key={label}
      type="button"
      size="icon"
      variant={active ? 'secondary' : 'ghost'}
      className="size-8"
      aria-label={label}
      disabled={!editable}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {icon}
    </Button>
  )

  function setOrEditLink() {
    const previous = editor.getAttributes('link').href as string | undefined
    const raw = window.prompt('URL', previous ?? 'https://')
    if (raw === null) return
    if (!raw.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    const href = normalizeUrl(raw)
    if (!href) {
      window.alert('Enter a valid http(s) URL.')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  function insertTable() {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run()
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)}>
      {editable ? (
        <div className="flex flex-wrap gap-0.5 border-b border-border-subtle bg-surface-2/40 p-1">
          {tool(() => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'Bold', <Bold className="size-3.5" />)}
          {tool(() => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'Italic', <Italic className="size-3.5" />)}
          {tool(() => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'Underline', <UnderlineIcon className="size-3.5" />)}
          {tool(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }), 'Heading', <Heading2 className="size-3.5" />)}
          {tool(() => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), 'Bullets', <List className="size-3.5" />)}
          {tool(() => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Numbers', <ListOrdered className="size-3.5" />)}
          {tool(() => editor.chain().focus().toggleTaskList().run(), editor.isActive('taskList'), 'Checklist', <ListChecks className="size-3.5" />)}
          {tool(() => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'), 'Quote', <Quote className="size-3.5" />)}
          {tool(() => editor.chain().focus().toggleCode().run(), editor.isActive('code'), 'Code', <Code className="size-3.5" />)}
          {tool(setOrEditLink, editor.isActive('link'), 'Link', <Link2 className="size-3.5" />)}
          {editor.isActive('link')
            ? tool(
                () => editor.chain().focus().extendMarkRange('link').unsetLink().run(),
                false,
                'Unlink',
                <Unlink className="size-3.5" />,
              )
            : null}
          {tool(insertTable, editor.isActive('table'), 'Table', <TableIcon className="size-3.5" />)}
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  )
}
