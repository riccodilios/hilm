import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckSquare, ChevronLeft, Eye, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { getNote, notesKeys, updateNote } from '@/features/notes/api'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { createTask, tasksKeys } from '@/features/tasks/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, Skeleton } from '@/components/ui/page'

export function NoteEditorPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const qc = useQueryClient()
  const [preview, setPreview] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const { data: note, isLoading } = useQuery({ queryKey: notesKeys.detail(id ?? ''), queryFn: () => getNote(id!), enabled: Boolean(id) })
  const { data: projects } = useQuery({ queryKey: projectsKeys.list(), queryFn: listProjects })
  useEffect(() => { if (note) { setTitle(note.title); setBody(note.body) } }, [note])
  const save = useMutation({
    mutationFn: () => updateNote(id!, { title: title.trim(), body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: notesKeys.all }); toast.success(t('notes.save')) },
    onError: (error: Error) => toast.error(error.message),
  })
  const convert = useMutation({
    mutationFn: () => {
      const projectId = note?.project_id ?? projects?.[0]?.id
      if (!projectId) throw new Error('Create a project before converting a note to a task')
      return createTask({ title: title.trim(), description: body, projectId })
    },
    onSuccess: async (task) => { await qc.invalidateQueries({ queryKey: tasksKeys.all }); toast.success(t('notes.convertTask')); window.location.assign(`/app/tasks/${task.id}`) },
    onError: (error: Error) => toast.error(error.message),
  })
  if (isLoading) return <Skeleton className="h-96" />
  if (!note) return <EmptyState title={t('notes.notFound')} action={<Button asChild><Link to="/app/notes">{t('notes.back')}</Link></Button>} />
  return <div className="mx-auto max-w-4xl">
    <div className="mb-4 flex items-center justify-between gap-2"><Button variant="ghost" size="sm" asChild><Link to="/app/notes"><ChevronLeft /> {t('notes.title')}</Link></Button><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setPreview((value) => !value)}>{preview ? <PenLine /> : <Eye />}{preview ? t('notes.edit') : t('notes.preview')}</Button><Button size="sm" variant="secondary" onClick={() => convert.mutate()} disabled={!title.trim() || (!note.project_id && !projects?.[0]) || convert.isPending}><CheckSquare /> {t('notes.convertTask')}</Button><Button size="sm" onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>{t('notes.save')}</Button></div></div>
    <Input value={title} onChange={(event) => setTitle(event.target.value)} className="mb-4 h-auto border-0 bg-transparent px-0 text-3xl font-medium tracking-tight shadow-none focus-visible:ring-0" placeholder={t('notes.empty')} />
    {preview ? <article className="prose prose-invert max-w-none rounded-2xl border border-border-subtle bg-surface/70 p-6 prose-headings:text-foreground prose-p:text-muted prose-a:text-accent">{body ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown> : <p className="text-muted">{t('notes.empty')}</p>}</article> : <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('notes.empty')} className="min-h-[60vh] resize-y font-mono text-sm leading-7" />}
  </div>
}
