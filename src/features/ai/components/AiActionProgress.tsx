import { Check, Circle, LoaderCircle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ActionExecutionResult } from '@/features/ai/lib/action-executor'
import { getRegisteredAction } from '@/features/ai/registry'
import type { AiAction } from '@/types/ai-actions'

export type ActionRunItem = {
  key: string
  label: string
  detail?: string
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
}

export function humanActionLabel(
  action: AiAction,
  os?: 'personal' | 'workspace',
) {
  const def = getRegisteredAction(String(action.type), os)
  if (action.type === 'task.create_many' && Array.isArray(action.items)) {
    return `Create ${action.items.length} tasks`
  }
  const title = typeof action.title === 'string' ? action.title : undefined
  const name = typeof action.name === 'string' ? action.name : undefined
  const summary = typeof action.summary === 'string' ? action.summary : undefined
  return title || name || summary || def?.title || String(action.type).replace(/\./g, ' ')
}

/** Short label for accept/apply chips — prefer task title over batch count. */
export function shortTaskTitle(title: string, max = 42) {
  const trimmed = title.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/**
 * Flatten proposed actions for the Accept UI so create_many shows each task title
 * instead of only "Create N tasks".
 */
export function flattenProposedActionLabels(
  actions: AiAction[],
  os?: 'personal' | 'workspace',
): Array<{ key: string; label: string; risk?: string }> {
  const rows: Array<{ key: string; label: string; risk?: string }> = []
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]!
    const risk = getRegisteredAction(String(action.type), os)?.risk
    if (action.type === 'task.create_many' && Array.isArray(action.items) && action.items.length) {
      for (let itemIndex = 0; itemIndex < action.items.length; itemIndex++) {
        const item = action.items[itemIndex]
        const title =
          item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string'
            ? (item as { title: string }).title
            : `Task ${itemIndex + 1}`
        rows.push({
          key: `${index}-create-many-${itemIndex}`,
          label: shortTaskTitle(title),
          risk: risk !== 'safe' ? risk : undefined,
        })
      }
      continue
    }
    rows.push({
      key: `${action.type}-${index}`,
      label: humanActionLabel(action, os),
      risk: risk !== 'safe' ? risk : undefined,
    })
  }
  return rows
}

export function resultsToRunItems(
  results: ActionExecutionResult[],
  os?: 'personal' | 'workspace',
): ActionRunItem[] {
  return results.map((result, index) => ({
    key: `${result.action.type}-${index}`,
    label: result.summary || humanActionLabel(result.action, os),
    status: result.success ? 'done' : 'error',
    error: result.error,
  }))
}

export function AiActionProgress({
  items,
  collapsedSummary,
  className,
}: {
  items: ActionRunItem[]
  collapsedSummary?: string | null
  className?: string
}) {
  const { t } = useTranslation()
  if (!items.length && !collapsedSummary) return null

  const allDone = items.length > 0 && items.every((item) => item.status === 'done' || item.status === 'error')
  const hasError = items.some((item) => item.status === 'error')
  const running = items.some((item) => item.status === 'running' || item.status === 'pending')

  return (
    <div
      className={cn(
        'rounded-2xl border border-border-subtle bg-surface/60 px-3.5 py-3 text-sm shadow-sm',
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
        {running ? (
          <>
            <LoaderCircle className="size-3.5 animate-spin" />
            {t('ai.workingOnIt', { defaultValue: 'Working on it…' })}
          </>
        ) : hasError ? (
          <>
            <X className="size-3.5 text-destructive" />
            {t('ai.actionsPartialFail', { defaultValue: 'Some actions didn’t finish' })}
          </>
        ) : (
          <>
            <Check className="size-3.5 text-accent" />
            {collapsedSummary ||
              t('ai.actionsComplete', { defaultValue: 'Actions complete' })}
          </>
        )}
      </div>
      {!allDone || hasError || !collapsedSummary ? (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0">
                {item.status === 'done' ? (
                  <Check className="size-3.5 text-accent" />
                ) : item.status === 'error' ? (
                  <X className="size-3.5 text-destructive" />
                ) : item.status === 'running' ? (
                  <LoaderCircle className="size-3.5 animate-spin text-muted" />
                ) : (
                  <Circle className="size-3.5 text-muted/50" />
                )}
              </span>
              <span className="min-w-0">
                <span className={cn(item.status === 'error' && 'text-destructive')}>
                  {item.label}
                </span>
                {item.error ? (
                  <span className="mt-0.5 block text-xs text-muted">
                    {item.error}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
