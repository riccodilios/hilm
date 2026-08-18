import { Check, Circle, FolderKanban, LoaderCircle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ActionExecutionResult } from '@/features/ai/lib/action-executor'
import {
  describeProposedActions,
  previewHeadline,
  type PreviewFact,
  type PreviewDirectory,
  type ProposedActionPreview,
} from '@/features/ai/lib/action-preview'
import type { ConversationEntityFocus } from '@/features/ai/lib/conversation-focus'
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
  focus?: ConversationEntityFocus | null,
  directory?: PreviewDirectory | null,
): Array<{ key: string; label: string; risk?: string }> {
  return describeProposedActions(actions, { os, focus, directory }).map((row) => ({
    key: row.key,
    label: [row.verb, previewHeadline(row)].filter(Boolean).join(' · '),
    risk: row.risk,
  }))
}

export function AiProposedActionList({
  actions,
  os,
  focus,
  directory,
  className,
}: {
  actions: AiAction[]
  os?: 'personal' | 'workspace'
  focus?: ConversationEntityFocus | null
  directory?: PreviewDirectory | null
  className?: string
}) {
  const rows = describeProposedActions(actions, { os, focus, directory })
  if (!rows.length) return null

  return (
    <ul className={cn('max-h-72 space-y-2.5 overflow-y-auto overscroll-y-auto pe-0.5', className)}>
      {rows.map((row) => (
        <ProposedActionCard key={row.key} row={row} />
      ))}
    </ul>
  )
}

const kindStyles: Record<ProposedActionPreview['kind'], string> = {
  create: 'bg-accent/12 text-accent',
  update: 'bg-info/12 text-info',
  delete: 'bg-destructive/12 text-destructive',
  other: 'bg-surface-3 text-muted',
}

function ProposedActionCard({ row }: { row: ProposedActionPreview }) {
  return (
    <li className="rounded-2xl border border-border-subtle bg-surface-2/80 px-3.5 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
            kindStyles[row.kind],
          )}
        >
          {row.verb}
        </span>
        {row.risk ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-warning">{row.risk}</span>
        ) : null}
      </div>
      <p className="mt-2 text-[15px] font-semibold leading-5 text-foreground">{row.title}</p>
      {row.taskRef && row.taskRef !== row.title ? (
        <p className="mt-0.5 font-mono text-[11px] tracking-wide text-muted">{row.taskRef}</p>
      ) : null}
      <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px] leading-4">
        {row.project ? (
          <FactRow label="Project" value={row.project} icon />
        ) : null}
        {row.facts.map((fact) => (
          <FactRow key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} />
        ))}
      </dl>
      {row.changes.length ? (
        <div className="mt-2.5 rounded-xl bg-surface/80 px-2.5 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Will change
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px] leading-4">
            {row.changes.map((fact) => (
              <ChangeRow key={`${fact.label}-${fact.value}`} fact={fact} />
            ))}
          </dl>
        </div>
      ) : null}
      {row.description ? (
        <p className="mt-2 text-[12px] leading-5 text-muted">{row.description}</p>
      ) : null}
    </li>
  )
}

function FactRow({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: boolean
}) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground">
        {icon ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <FolderKanban className="size-3 shrink-0 text-muted" />
            <span className="truncate">{value}</span>
          </span>
        ) : (
          <span className="truncate">{value}</span>
        )}
      </dd>
    </>
  )
}

function ChangeRow({ fact }: { fact: PreviewFact }) {
  return (
    <>
      <dt className="text-muted">{fact.label}</dt>
      <dd className="min-w-0 font-medium text-foreground">
        <span className="text-muted">→ </span>
        {fact.value}
      </dd>
    </>
  )
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
                ) : item.detail ? (
                  <span className="mt-0.5 block text-xs text-muted">{item.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
