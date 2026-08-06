import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ManagedLabelChip } from '@/components/labels/ManagedLabelChip'
import { EditLabelDialog, type LabelDraft } from '@/components/labels/EditLabelDialog'
import { DeleteLabelConfirm } from '@/components/labels/DeleteLabelConfirm'
import type { LabelMenuAction } from '@/components/labels/LabelContextMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PROJECT_COLORS } from '@/types/domain'

export type ManagedLabel = { id: string; name: string; color: string }

type LabelsBarProps = {
  labels: ManagedLabel[]
  filter: string | 'all'
  onFilterChange: (id: string | 'all') => void
  canManage: boolean
  queryKey: readonly unknown[]
  createLabel: (input: { name: string; color: string }) => Promise<unknown>
  updateLabel: (id: string, patch: { name?: string; color?: string }) => Promise<unknown>
  deleteLabel: (id: string) => Promise<unknown>
}

export function LabelsBar({
  labels,
  filter,
  onFilterChange,
  canManage,
  queryKey,
  createLabel,
  updateLabel,
  deleteLabel,
}: LabelsBarProps) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState<{
    draft: LabelDraft
    mode: 'edit' | 'create' | 'rename' | 'recolor'
  } | null>(null)
  const [deleting, setDeleting] = useState<ManagedLabel | null>(null)
  const [saving, setSaving] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey })

  const createMut = useMutation({
    mutationFn: () => createLabel({ name: search.trim() || 'Work', color: PROJECT_COLORS[0] }),
    onSuccess: async () => {
      await invalidate()
      setSearch('')
      toast.success('Label created')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteLabel(deleting!.id),
    onSuccess: async () => {
      const deletedId = deleting?.id
      await invalidate()
      setDeleting(null)
      if (filter === deletedId) onFilterChange('all')
      toast.success('Label deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleMenu(action: LabelMenuAction, label: ManagedLabel) {
    if (action === 'delete') {
      setDeleting(label)
      return
    }
    setEdit({
      draft: { id: label.id, name: label.name, color: label.color },
      mode: action === 'edit' ? 'edit' : action === 'rename' ? 'rename' : 'recolor',
    })
  }

  async function handleSave(draft: { name: string; color: string }) {
    if (!edit) return
    setSaving(true)
    try {
      if (edit.mode === 'create' || !edit.draft.id) {
        await createLabel({ name: draft.name, color: draft.color })
      } else {
        await updateLabel(edit.draft.id, { name: draft.name, color: draft.color })
      }
      await invalidate()
      setEdit(null)
      toast.success('Label updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update label')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onFilterChange('all')}
          className={`rounded-full border px-3 py-1 text-xs ${
            filter === 'all' ? 'border-accent/40 bg-accent/10' : 'border-border-subtle'
          }`}
        >
          All
        </button>
        {labels.map((label) => (
          <ManagedLabelChip
            key={label.id}
            id={label.id}
            name={label.name}
            color={label.color}
            selected={filter === label.id}
            canManage={canManage}
            onSelect={onFilterChange}
            onMenuAction={canManage ? handleMenu : undefined}
          />
        ))}
        {canManage ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (search.trim()) createMut.mutate()
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="New label"
              className="h-8 w-32"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={createMut.isPending}>
              +
            </Button>
          </form>
        ) : null}
      </div>

      <EditLabelDialog
        open={Boolean(edit)}
        onOpenChange={(open) => !open && setEdit(null)}
        initial={edit?.draft}
        mode={edit?.mode ?? 'edit'}
        pending={saving}
        onSave={handleSave}
      />

      <DeleteLabelConfirm
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        labelName={deleting?.name ?? ''}
        pending={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate()}
      />
    </>
  )
}
