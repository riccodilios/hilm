import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  createWorkspaceProjectNote,
  deleteWorkspaceProjectNote,
  listWorkspaceProjectNotes,
  projectContentKeys,
  updateWorkspaceProjectNote,
  type WorkspaceProjectNote,
} from '@/features/workspace-os/project-content-api'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/page'
import { htmlToPlainText } from '@/lib/voice-transcript'
import { cn, formatRelative } from '@/lib/utils'

export function WorkspaceProjectNotes({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string
  projectId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const key = projectContentKeys.notes(workspaceId, projectId)
  const notes = useQuery({ queryKey: key, queryFn: () => listWorkspaceProjectNotes(workspaceId, projectId) })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = notes.data ?? []
  const selected = list.find((note) => note.id === selectedId) ?? list[0] ?? null

  const create = useMutation({
    mutationFn: () => createWorkspaceProjectNote(workspaceId, projectId, t('workspace.projectNoteUntitled')),
    onSuccess: async (note) => {
      await qc.invalidateQueries({ queryKey: key })
      setSelectedId(note.id)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const save = useMutation({
    mutationFn: (input: { id: string; patch: Partial<Pick<WorkspaceProjectNote, 'title' | 'body'>> }) =>
      updateWorkspaceProjectNote(workspaceId, input.id, input.patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: key })
      toast.success(t('workspace.projectNoteSaved'))
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteWorkspaceProjectNote(workspaceId, id),
    onSuccess: async () => {
      setSelectedId(null)
      await qc.invalidateQueries({ queryKey: key })
      toast.success(t('workspace.projectNoteDeleted'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (notes.isLoading) return <Skeleton className="h-64" />

  if (!list.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
        <p className="text-sm text-muted">{t('workspace.projectNotesEmpty')}</p>
        {canEdit ? (
          <Button className="mt-4" onClick={() => create.mutate()} disabled={create.isPending}>
            <Plus className="size-4" /> {t('notes.new')}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <div className="space-y-2">
        {canEdit ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            <Plus className="size-4" /> {t('notes.new')}
          </Button>
        ) : null}
        <div className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
          {list.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => setSelectedId(note.id)}
              className={cn(
                'min-w-44 rounded-xl border px-3 py-2 text-start transition-colors md:min-w-0',
                selected?.id === note.id
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-border-subtle bg-surface/60 hover:border-border',
              )}
            >
              <p className="truncate text-sm font-medium">{note.title || t('workspace.projectNoteUntitled')}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">
                {htmlToPlainText(note.body).slice(0, 140) || formatRelative(note.updated_at)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <div key={selected.id} className="min-w-0 space-y-3 rounded-2xl border border-border-subtle bg-surface/60 p-4">
          <div className="flex items-center gap-2">
            <Input
              defaultValue={selected.title}
              disabled={!canEdit}
              maxLength={300}
              aria-label={t('workspace.projectNoteTitle')}
              placeholder={t('workspace.projectNoteTitle')}
              className="h-10 text-base font-medium"
              onBlur={(event) => {
                const title = event.target.value.trim()
                if (title === selected.title) return
                save.mutate({ id: selected.id, patch: { title } })
              }}
            />
            {canEdit ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0 text-muted hover:text-danger"
                aria-label={t('common.delete')}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(t('notes.deleteConfirm'))) remove.mutate(selected.id)
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
          <RichTextEditor
            value={selected.body}
            editable={canEdit}
            onChange={() => undefined}
            onBlur={(html) => {
              const saved = qc
                .getQueryData<WorkspaceProjectNote[]>(key)
                ?.find((note) => note.id === selected.id)?.body
              if (!canEdit || html === (saved ?? selected.body)) return
              save.mutate({ id: selected.id, patch: { body: html } })
            }}
          />
          <p className="text-[11px] text-muted">{formatRelative(selected.updated_at)}</p>
        </div>
      ) : null}
    </div>
  )
}
