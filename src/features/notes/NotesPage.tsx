import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createNote, listNotes, notesKeys } from '@/features/notes/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/page'
import { formatRelative } from '@/lib/utils'

export function NotesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const { data: notes, isLoading } = useQuery({ queryKey: notesKeys.list(), queryFn: () => listNotes() })
  const create = useMutation({
    mutationFn: () => createNote({ title }),
    onSuccess: async (note) => { await qc.invalidateQueries({ queryKey: notesKeys.all }); navigate(`/app/notes/${note.id}`) },
    onError: (error: Error) => toast.error(error.message),
  })
  return <div>
    <PageHeader title="Notes" description="Capture thinking before it gets lost." actions={<Button onClick={() => setOpen(true)}><Plus /> New note</Button>} />
    {isLoading ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : !notes?.length ? <EmptyState title="No notes yet" description="Start a note for an idea, decision, or research." action={<Button onClick={() => setOpen(true)}><Plus /> New note</Button>} /> : <div className="grid gap-3 sm:grid-cols-2">
      {notes.map((note) => <Link key={note.id} to={`/app/notes/${note.id}`} className="rounded-2xl border border-border-subtle bg-surface/70 p-5 transition hover:border-border hover:bg-surface"><FileText className="mb-5 size-5 text-accent" /><h2 className="font-medium">{note.title}</h2><p className="mt-2 line-clamp-2 text-sm text-muted">{note.body || 'Empty note'}</p><p className="mt-4 text-xs text-muted">Updated {formatRelative(note.updated_at)}</p></Link>)}
    </div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>New note</DialogTitle><DialogDescription>Give your note a useful title.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate() }}><div className="space-y-2"><Label htmlFor="note-title">Title</Label><Input id="note-title" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus /></div><Button type="submit" className="w-full" disabled={create.isPending}>Create note</Button></form></DialogContent></Dialog>
  </div>
}
