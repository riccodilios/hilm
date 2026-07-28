import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckSquare, ChevronLeft, Eye, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { getNote, notesKeys, updateNote } from '@/features/notes/api'
import { createTask, tasksKeys } from '@/features/tasks/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, Skeleton } from '@/components/ui/page'

export function NoteEditorPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [preview, setPreview] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const { data: note, isLoading } = useQuery({ queryKey: notesKeys.detail(id ?? ''), queryFn: () => getNote(id!), enabled: Boolean(id) })
  useEffect(() => { if (note) { setTitle(note.title); setBody(note.body) } }, [note])
  const save = useMutation({
    mutationFn: () => updateNote(id!, { title: title.trim(), body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: notesKeys.all }); toast.success('Note saved') },
    onError: (error: Error) => toast.error(error.message),
  })
  const convert = useMutation({
    mutationFn: () => createTask({ title: title.trim(), description: body, projectId: note?.project_id }),
    onSuccess: async (task) => { await qc.invalidateQueries({ queryKey: tasksKeys.all }); toast.success('Task created from note'); window.location.assign(`/tasks/${task.id}`) },
    onError: (error: Error) => toast.error(error.message),
  })
  if (isLoading) return <Skeleton className="h-96" />
  if (!note) return <EmptyState title="Note not found" action={<Button asChild><Link to="/notes">Back to notes</Link></Button>} />
  return <div className="mx-auto max-w-4xl">
    <div className="mb-4 flex items-center justify-between gap-2"><Button variant="ghost" size="sm" asChild><Link to="/notes"><ChevronLeft /> Notes</Link></Button><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setPreview((value) => !value)}>{preview ? <PenLine /> : <Eye />}{preview ? 'Edit' : 'Preview'}</Button><Button size="sm" variant="secondary" onClick={() => convert.mutate()} disabled={!title.trim() || convert.isPending}><CheckSquare /> Convert to task</Button><Button size="sm" onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>Save</Button></div></div>
    <Input value={title} onChange={(event) => setTitle(event.target.value)} className="mb-4 h-auto border-0 bg-transparent px-0 text-3xl font-medium tracking-tight shadow-none focus-visible:ring-0" placeholder="Untitled note" />
    {preview ? <article className="prose prose-invert max-w-none rounded-2xl border border-border-subtle bg-surface/70 p-6 prose-headings:text-foreground prose-p:text-muted prose-a:text-accent">{body ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown> : <p className="text-muted">Nothing to preview.</p>}</article> : <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write in Markdown…" className="min-h-[60vh] resize-y font-mono text-sm leading-7" />}
  </div>
}
