import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarClock, Check, ExternalLink, Loader2, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { speakerName } from '../format'
import { useCreateTasksFromActions, useMeetingMutations, type CreateTasksResult } from '../hooks'
import type { MeetingActionItem, MeetingDetail, MeetingsAdapter } from '../types'
import { SourceLinks } from './MeetingSummarySection'

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

export function MeetingActionItems({
  adapter,
  detail,
  displayDetail,
  onJump,
}: {
  adapter: MeetingsAdapter
  detail: MeetingDetail
  /** Translated copy used only for display; edits and tasks always use `detail`. */
  displayDetail?: MeetingDetail
  onJump: (segmentId: string) => void
}) {
  const { t } = useTranslation()
  const mutations = useMeetingMutations(adapter, detail.meeting.id)
  const createTasks = useCreateTasksFromActions(adapter, detail)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const speakers = useMemo(() => new Map(detail.speakers.map((speaker) => [speaker.id, speaker])), [detail.speakers])
  const open = detail.actionItems.filter((item) => !item.taskId)
  const shownById = useMemo(
    () => new Map((displayDetail ?? detail).actionItems.map((item) => [item.id, item])),
    [detail, displayDetail],
  )

  const report = (result: CreateTasksResult) => {
    if (result.created) toast.success(t('meetings.actions.createdToast', { count: result.created }))
    if (result.existing && !result.created) toast.message(t('meetings.actions.alreadyCreated'))
    if (result.failed) toast.error(t('meetings.actions.failedToast', { count: result.failed }))
  }

  const run = async (items: MeetingActionItem[]) => {
    const pending = items.filter((item) => !item.taskId && !busyIds.has(item.id))
    if (!pending.length) return
    setBusyIds((prev) => new Set([...prev, ...pending.map((item) => item.id)]))
    try {
      report(await createTasks.mutateAsync(pending))
      setSelected(new Set())
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        for (const item of pending) next.delete(item.id)
        return next
      })
    }
  }

  if (!detail.actionItems.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        {t('meetings.actions.empty')}
      </p>
    )
  }

  const selectedItems = open.filter((item) => selected.has(item.id))

  return (
    <div className="space-y-3">
      {adapter.canEdit && open.length ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!selectedItems.length || createTasks.isPending}
            onClick={() => void run(selectedItems)}
          >
            {t('meetings.actions.createSelected', { count: selectedItems.length })}
          </Button>
          <Button size="sm" disabled={createTasks.isPending} onClick={() => void run(open)}>
            {createTasks.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            {t('meetings.actions.createAll', { count: open.length })}
          </Button>
        </div>
      ) : null}

      <ul className="space-y-2">
        {detail.actionItems.map((item) => {
          const owner = item.ownerSpeakerId ? speakers.get(item.ownerSpeakerId) : undefined
          const busy = busyIds.has(item.id)
          if (editingId === item.id) {
            return (
              <li key={item.id}>
                <ActionItemEditor
                  item={item}
                  detail={detail}
                  onCancel={() => setEditingId(null)}
                  onSave={async (patch) => {
                    try {
                      await mutations.editItem.mutateAsync({ itemId: item.id, patch })
                      setEditingId(null)
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : t('meetings.errors.generic'))
                    }
                  }}
                />
              </li>
            )
          }
          return (
            <li key={item.id} className="rounded-xl border border-border-subtle bg-surface/60 p-3">
              <div className="flex items-start gap-3">
                {adapter.canEdit && !item.taskId ? (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--color-accent,#60a5fa)]"
                    checked={selected.has(item.id)}
                    onChange={(event) =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (event.target.checked) next.add(item.id)
                        else next.delete(item.id)
                        return next
                      })
                    }
                    aria-label={t('meetings.actions.select', { title: item.title })}
                  />
                ) : (
                  <Check className={`mt-1 size-4 shrink-0 ${item.taskId ? 'text-success' : 'text-muted'}`} />
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-sm font-medium leading-6" dir="auto">
                    {shownById.get(item.id)?.title ?? item.title}
                  </p>
                  {item.description ? (
                    <p className="text-xs leading-5 text-muted" dir="auto">
                      {shownById.get(item.id)?.description ?? item.description}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="size-3.5" />
                      {owner && item.ownerCertainty !== 'none'
                        ? speakerName(owner, owner.label)
                        : t('meetings.actions.noOwner')}
                      {owner && item.ownerCertainty === 'uncertain' ? ` (${t('meetings.certainty.uncertain')})` : ''}
                    </span>
                    {item.dueText || item.dueDate ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" />
                        {item.dueDate ?? item.dueText}
                        {item.dueText && item.dueDate ? ` · “${item.dueText}”` : ''}
                      </span>
                    ) : null}
                    {item.certainty === 'possible' ? (
                      <Badge className="bg-warning/15 text-warning">{t('meetings.certainty.possible')}</Badge>
                    ) : null}
                    {item.priority && item.priority !== 'none' ? (
                      <Badge className="bg-surface-3 text-muted">{t(`priority.${item.priority}`)}</Badge>
                    ) : null}
                    <SourceLinks ids={item.sourceSegmentIds} detail={displayDetail ?? detail} onJump={onJump} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.taskId ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link to={adapter.tasks.taskHref(item.taskId)}>
                        <ExternalLink /> <span className="hidden sm:inline">{t('meetings.actions.viewTask')}</span>
                      </Link>
                    </Button>
                  ) : adapter.canEdit ? (
                    <>
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run([item])}>
                        {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                        <span className="hidden sm:inline">{t('meetings.actions.createTask')}</span>
                      </Button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-foreground"
                        onClick={() => setEditingId(item.id)}
                        aria-label={t('common.edit')}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger"
                        onClick={() => mutations.removeItem.mutate(item.id)}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ActionItemEditor({
  item,
  detail,
  onSave,
  onCancel,
}: {
  item: MeetingActionItem
  detail: MeetingDetail
  onSave: (patch: {
    title: string
    ownerSpeakerId: string | null
    dueDate: string | null
    priority: MeetingActionItem['priority']
  }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(item.title)
  const [owner, setOwner] = useState(item.ownerSpeakerId ?? '')
  const [due, setDue] = useState(item.dueDate ?? '')
  const [priority, setPriority] = useState<string>(item.priority ?? 'none')
  const [saving, setSaving] = useState(false)

  return (
    <form
      className="space-y-3 rounded-xl border border-border bg-surface p-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!title.trim()) return
        setSaving(true)
        await onSave({
          title,
          ownerSpeakerId: owner || null,
          dueDate: due || null,
          priority: priority as MeetingActionItem['priority'],
        })
        setSaving(false)
      }}
    >
      <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t('meetings.fields.title')} dir="auto" />
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
          aria-label={t('meetings.actions.owner')}
        >
          <option value="">{t('meetings.actions.noOwner')}</option>
          {detail.speakers.map((speaker) => (
            <option key={speaker.id} value={speaker.id}>
              {speakerName(speaker, speaker.label)}
            </option>
          ))}
        </select>
        <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label={t('meetings.actions.due')} />
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
          aria-label={t('tasks.priority')}
        >
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {t(`priority.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X /> {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={saving || !title.trim()}>
          <Check /> {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
