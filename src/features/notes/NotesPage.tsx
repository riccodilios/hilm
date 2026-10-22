import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createNote, listNotes, notesKeys } from '@/features/notes/api'
import { NoteActionsDialog } from '@/features/notes/NoteActionsDialog'
import { NoteCard } from '@/features/notes/NoteCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/page'
import type { Tables } from '@/types/database'

export function NotesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [menuNote, setMenuNote] = useState<Tables<'notes'> | null>(null)
  const { data: notes, isLoading } = useQuery({ queryKey: notesKeys.list(), queryFn: () => listNotes() })
  const create = useMutation({
    mutationFn: () => createNote({ title }),
    onSuccess: async (note) => {
      setOpen(false)
      setTitle('')
      navigate(`/personal/notes/${note.id}`)
      await qc.invalidateQueries({ queryKey: notesKeys.all })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={t('notes.title')}
        description={t('search.description')}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> {t('notes.new')}
          </Button>
        }
      />
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : !notes?.length ? (
        <EmptyState
          title={t('home.noNotes')}
          description={t('notes.empty')}
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus /> {t('notes.new')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onOpenMenu={setMenuNote} />
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('notes.new')}</DialogTitle>
            <DialogDescription>{t('notes.empty')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="note-title">{t('projects.name')}</Label>
              <Input
                id="note-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {t('common.create')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <NoteActionsDialog note={menuNote} onClose={() => setMenuNote(null)} />
    </div>
  )
}
