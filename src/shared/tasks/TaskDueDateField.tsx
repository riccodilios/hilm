import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toLocalDateKey } from '@/lib/dates'

/** Patch that clears every due-date field Hilm stores for a task. */
export function clearTaskDueDatePatch() {
  return {
    due_date: null,
    due_at: null,
    due_time: null,
  } as const
}

function dueDateValue(dueDate?: string | null, dueAt?: string | null) {
  if (dueDate) return toLocalDateKey(dueDate.slice(0, 10)) ?? ''
  if (dueAt) return toLocalDateKey(dueAt) ?? ''
  return ''
}

/**
 * Shared Personal/Workspace due-date editor with an explicit Clear Date action.
 * Native date inputs often hide or omit their clear control on mobile PWAs.
 */
export function TaskDueDateField({
  id = 'due-date',
  dueDate,
  dueAt,
  disabled,
  onChange,
}: {
  id?: string
  dueDate?: string | null
  dueAt?: string | null
  disabled?: boolean
  /** Receives a local YYYY-MM-DD string, or null when cleared. */
  onChange: (dueDate: string | null) => void
}) {
  const { t } = useTranslation()
  const remote = dueDateValue(dueDate, dueAt)
  const [value, setValue] = useState(remote)

  useEffect(() => {
    setValue(remote)
  }, [remote])

  const hasDate = Boolean(value)

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('tasks.due')}</Label>
      <Input
        id={id}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value || null
          setValue(next ?? '')
          onChange(next)
        }}
      />
      {hasDate ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted hover:text-foreground"
          disabled={disabled}
          onClick={() => {
            setValue('')
            onChange(null)
          }}
        >
          {t('tasks.clearDate')}
        </Button>
      ) : null}
    </div>
  )
}
