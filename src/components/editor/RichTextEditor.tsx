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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type MentionOption = { id: string; label: string }

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
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value || '',
    editable,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    onBlur: ({ editor: ed }) => onBlur?.(ed.getHTML()),
    editorProps: {
      attributes: {
        class:
          'prose prose-invert max-w-none min-h-[120px] px-3 py-2 text-sm focus:outline-none [&_ul]:list-disc [&_ol]:list-decimal',
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
          {tool(
            () => {
              const url = window.prompt('URL')
              if (!url) return
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
            },
            editor.isActive('link'),
            'Link',
            <Link2 className="size-3.5" />,
          )}
          {tool(
            () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
            false,
            'Table',
            <TableIcon className="size-3.5" />,
          )}
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  )
}
