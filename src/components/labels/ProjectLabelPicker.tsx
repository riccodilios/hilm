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
  const selected = labels.filter((label) => selectedIds.includes(label.id))
  const available = labels.filter((label) => !selectedIds.includes(label.id))

  if (!labels.length) {
    return <p className="text-xs text-muted">No labels yet. Create one from the Projects page.</p>
  }

  return (
    <div className={cn('space-y-3', className)}>
      {selected.length ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((label) => (
            <LabelChip
              key={label.id}
              name={label.name}
              color={label.color}
              onRemove={
                disabled
                  ? undefined
                  : () => onChange(selectedIds.filter((id) => id !== label.id))
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No labels on this project yet.</p>
      )}

      <select
        disabled={disabled || !available.length}
        value=""
        aria-label="Add label"
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm disabled:opacity-50"
        onChange={(event) => {
          const id = event.target.value
          if (!id || disabled) return
          if (selectedIds.includes(id)) return
          onChange([...selectedIds, id])
        }}
      >
        <option value="">
          {available.length ? 'Add label…' : 'All labels already applied'}
        </option>
        {available.map((label) => (
          <option key={label.id} value={label.id}>
            {label.name}
          </option>
        ))}
      </select>
    </div>
  )
}
