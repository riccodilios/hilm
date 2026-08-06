import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LabelColorPicker } from '@/components/labels/LabelColorPicker'
import { PROJECT_COLORS } from '@/types/domain'

export type LabelDraft = {
  id?: string
  name: string
  color: string
}

export function EditLabelDialog({
  open,
  onOpenChange,
  initial,
  mode = 'edit',
  pending,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: LabelDraft | null
  mode?: 'edit' | 'create' | 'rename' | 'recolor'
  pending?: boolean
  onSave: (draft: { name: string; color: string }) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? PROJECT_COLORS[0])

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setColor(initial?.color ?? PROJECT_COLORS[0])
    }
  }, [open, initial?.name, initial?.color])

  const title =
    mode === 'create'
      ? 'Create label'
      : mode === 'rename'
        ? 'Rename label'
        : mode === 'recolor'
          ? 'Change color'
          : 'Edit label'

  const showName = mode !== 'recolor'
  const showColor = mode !== 'rename'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Changes update everywhere this label is used.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            onSave({ name: name.trim(), color })
          }}
        >
          {showName ? (
            <div className="space-y-2">
              <Label htmlFor="edit-label-name">Name</Label>
              <Input
                id="edit-label-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
          ) : null}
          {showColor ? (
            <LabelColorPicker name={name} color={color} onColorChange={setColor} />
          ) : null}
          <Button type="submit" className="w-full" disabled={pending || !name.trim()}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
