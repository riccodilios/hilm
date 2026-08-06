import { LabelChip } from '@/components/labels/LabelChip'
import { cn } from '@/lib/utils'

export type PickerLabel = { id: string; name: string; color: string }

export function ProjectLabelPicker({
  labels,
  selectedIds,
  onChange,
  disabled,
  className,
}: {
  labels: PickerLabel[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  className?: string
}) {
  function toggle(id: string) {
    if (disabled) return
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id))
    else onChange([...selectedIds, id])
  }

  if (!labels.length) {
    return <p className="text-xs text-muted">No labels yet.</p>
  }

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {labels.map((label) => {
        const active = selectedIds.includes(label.id)
        return (
          <button
            key={label.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(label.id)}
            className={cn(active && 'ring-1 ring-accent rounded-md')}
          >
            <LabelChip name={label.name} color={label.color} />
          </button>
        )
      })}
    </div>
  )
}
