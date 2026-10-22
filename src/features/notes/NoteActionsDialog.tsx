import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FolderInput, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteNote, notesKeys, updateNote } from '@/features/notes/api'
import { listProjects, projectsKeys } from '@/features/projects/api'
import { homeKeys } from '@/features/home/api'
import { activityKeys } from '@/features/activity/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { Tables } from '@/types/database'

export function NoteActionsDialog({
  note,
  onClose,
}: {
  note: Tables<'notes'> | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: projects } = useQuery({
    queryKey: projectsKeys.list(),
    queryFn: listProjects,
    enabled: Boolean(note),
  })

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: notesKeys.all }),
      qc.invalidateQueries({ queryKey: projectsKeys.all }),
      qc.invalidateQueries({ queryKey: homeKeys.all }),
      qc.invalidateQueries({ queryKey: activityKeys.all }),
    ])

  const moveProject = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      updateNote(id, { project_id: projectId }),
    onSuccess: async (_data, vars) => {
      const projectName = (projects ?? []).find((project) => project.id === vars.projectId)?.name
      onClose()
      toast.success(
        projectName ? t('notes.movedProjectNamed', { project: projectName }) : t('notes.movedProject'),
      )
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: async (_data, id) => {
      onClose()
      toast.success(t('notes.deleted'))
      await invalidate()
      if (window.location.pathname.includes(`/notes/${id}`)) {
        navigate('/personal/notes')
      }
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const otherProjects = (projects ?? []).filter((project) => project.id !== note?.project_id)

  return (
    <Dialog open={Boolean(note)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-6" dir="auto">
            {note?.title}
          </DialogTitle>
          <DialogDescription>{t('notes.actionsHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {note && otherProjects.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border-subtle bg-surface/40 p-3">
              <Label htmlFor="note-move-project" className="flex items-center gap-2 text-xs">
                <FolderInput className="size-3.5" /> {t('notes.moveToProject')}
              </Label>
              <select
                id="note-move-project"
                defaultValue=""
                disabled={moveProject.isPending}
                onChange={(event) => {
                  const projectId = event.target.value
                  if (!note || !projectId) return
                  moveProject.mutate({ id: note.id, projectId })
                }}
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
              >
                <option value="" disabled>
                  {t('notes.chooseProject')}
                </option>
                {otherProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Button
            variant="secondary"
            className="justify-start text-[color:var(--color-danger)]"
            disabled={remove.isPending}
            onClick={() => {
              if (!note) return
              if (!window.confirm(t('notes.deleteConfirm', { title: note.title }))) return
              remove.mutate(note.id)
            }}
          >
            <Trash2 className="size-4" /> {t('notes.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
