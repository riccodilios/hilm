import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarDays, CheckSquare, Clock, Loader2, Mic, MoreHorizontal, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { useLongPress } from '@/hooks/useLongPress'
import { useMeetingMutations, useMeetingsList } from '../hooks'
import { formatDurationShort } from '../format'
import { useMeetingRecorder } from '../recorder/recorder-context'
import type { Meeting, MeetingProjectOption, MeetingsAdapter } from '../types'
import { MeetingStatusBadge } from './MeetingStatusBadge'
import { ConfirmDialog } from './ConfirmDialog'
import { MEETING_MENU_WIDTH, MeetingContextMenu, type MeetingMenuAction } from './MeetingContextMenu'
import { MeetingEditDialog } from './MeetingEditDialog'
import { MeetingMoveDialog } from './MeetingMoveDialog'

type SortKey = 'newest' | 'oldest' | 'title' | 'longest'

function meetingDate(meeting: Meeting) {
  return meeting.heldAt ?? meeting.startedAt ?? meeting.createdAt
}

export function MeetingsListView({ adapter }: { adapter: MeetingsAdapter }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const list = useMeetingsList(adapter)
  const mutations = useMeetingMutations(adapter)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Meeting | null>(null)
  const [menu, setMenu] = useState<{ meeting: Meeting; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<Meeting | null>(null)
  const [moving, setMoving] = useState<Meeting | null>(null)
  const recorder = useMeetingRecorder()
  // Drive all processing meetings. Server cool-down returns state=waiting (no AI spend);
  // skipping waiting_quota here stranded meetings that never got a detail-panel resume tick.
  const processingIds = (list.data ?? [])
    .filter((meeting) => meeting.status === 'processing')
    .map((meeting) => meeting.id)
    .join(',')

  useEffect(() => {
    if (!adapter.canEdit || !processingIds) return
    // Stagger list-driven advances so multiple processing meetings don't stampede the API.
    const ids = processingIds.split(',').filter(Boolean)
    const timers = ids.map((id, index) =>
      window.setTimeout(() => {
        recorder.driveProcessing(adapter.scope.os, id, i18n.language)
      }, index * 2_500),
    )
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter.canEdit, adapter.scope.os, processingIds])

  const meetings = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = (list.data ?? []).filter((meeting) => {
      if (!query) return true
      return [meeting.title, meeting.description ?? '', meeting.summary ?? '', meeting.participants.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, i18n.language)
      if (sort === 'longest') return b.durationSeconds - a.durationSeconds
      const diff = new Date(meetingDate(b)).getTime() - new Date(meetingDate(a)).getTime()
      return sort === 'oldest' ? -diff : diff
    })
    return sorted
  }, [i18n.language, list.data, search, sort])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const startNewMeeting = async () => {
    if (creating) return
    setCreating(true)
    try {
      const now = new Date()
      const meeting = await mutations.create.mutateAsync({
        title: t('meetings.new.defaultTitle', { date: dateFormatter.format(now) }),
        description: null,
        heldAt: now.toISOString(),
        participants: [],
      })
      navigate(adapter.meetingHref(meeting.id), { state: { autoRecord: true } })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.createFailed'))
      setCreating(false)
    }
  }

  const closeMenu = useCallback(() => setMenu(null), [])

  const menuActionsFor = (meeting: Meeting): MeetingMenuAction[] => {
    const actions: MeetingMenuAction[] = []
    if (adapter.canEdit) actions.push('edit')
    // A live recording keeps uploading into its meeting; moving it mid-capture is confusing.
    if (adapter.canEdit && adapter.moveTargets && meeting.status !== 'recording') actions.push('move')
    if (adapter.canDelete(meeting)) actions.push('delete')
    return actions
  }

  const confirmMove = async (project: MeetingProjectOption) => {
    if (!moving || !adapter.moveTargets) return
    const meetingId = moving.id
    const href = adapter.moveTargets.meetingHref(project.id, meetingId)
    try {
      await mutations.move.mutateAsync({ id: meetingId, projectId: project.id })
      setMoving(null)
      toast.success(t('meetings.move.done', { project: project.name }), {
        action: { label: t('common.open'), onClick: () => navigate(href) },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.move.failed'))
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await mutations.remove.mutateAsync(pendingDelete.id)
      toast.success(t('meetings.deleted'))
      setPendingDelete(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.deleteFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('meetings.list.search')}
            className="ps-9"
            aria-label={t('meetings.list.search')}
          />
        </div>
        <div className="flex gap-2">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm sm:flex-none"
            aria-label={t('meetings.list.sort')}
          >
            <option value="newest">{t('meetings.list.sortNewest')}</option>
            <option value="oldest">{t('meetings.list.sortOldest')}</option>
            <option value="title">{t('meetings.list.sortTitle')}</option>
            <option value="longest">{t('meetings.list.sortLongest')}</option>
          </select>
          {adapter.canEdit ? (
            <Button onClick={() => void startNewMeeting()} disabled={creating}>
              {creating ? <Loader2 className="animate-spin" /> : <Plus />} {t('meetings.new.button')}
            </Button>
          ) : null}
        </div>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : list.isError ? (
        <EmptyState
          title={t('meetings.errors.loadFailed')}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : !list.data?.length ? (
        <EmptyState
          title={t('meetings.list.emptyTitle')}
          description={t('meetings.list.emptyDescription')}
          action={
            adapter.canEdit ? (
              <Button onClick={() => void startNewMeeting()} disabled={creating}>
                <Mic /> {t('meetings.list.emptyAction')}
              </Button>
            ) : undefined
          }
        />
      ) : !meetings.length ? (
        <EmptyState title={t('meetings.list.noMatches')} />
      ) : (
        <ul className="space-y-2">
          {meetings.map((meeting) => (
            <li key={meeting.id}>
              <MeetingCard
                meeting={meeting}
                href={adapter.meetingHref(meeting.id)}
                dateLabel={dateFormatter.format(new Date(meetingDate(meeting)))}
                hasMenu={menuActionsFor(meeting).length > 0}
                onOpenMenu={(x, y) => setMenu({ meeting, x, y })}
              />
            </li>
          ))}
        </ul>
      )}

      <MeetingContextMenu
        position={menu ? { x: menu.x, y: menu.y } : null}
        actions={menu ? menuActionsFor(menu.meeting) : []}
        onClose={closeMenu}
        onAction={(action) => {
          if (!menu) return
          if (action === 'edit') setEditing(menu.meeting)
          if (action === 'move') setMoving(menu.meeting)
          if (action === 'delete') setPendingDelete(menu.meeting)
        }}
      />
      <MeetingEditDialog
        meeting={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={async (patch) => {
          if (!editing) return
          await mutations.edit.mutateAsync({ id: editing.id, patch })
          toast.success(t('meetings.edit.saved'))
        }}
      />
      {adapter.moveTargets ? (
        <MeetingMoveDialog
          meeting={moving}
          scope={adapter.scope}
          targets={adapter.moveTargets}
          pending={mutations.move.isPending}
          onOpenChange={(open) => !open && setMoving(null)}
          onMove={(project) => void confirmMove(project)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('meetings.delete.title')}
        description={t('meetings.delete.description')}
        confirmLabel={t('meetings.delete.confirm')}
        destructive
        pending={mutations.remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}

function MeetingCard({
  meeting,
  href,
  dateLabel,
  hasMenu,
  onOpenMenu,
}: {
  meeting: Meeting
  href: string
  dateLabel: string
  hasMenu: boolean
  onOpenMenu: (x: number, y: number) => void
}) {
  const { t } = useTranslation()
  // The long press ends with a click on the card link; swallow that one click.
  const suppressClick = useRef(false)
  const longPress = useLongPress((event: ReactPointerEvent | ReactMouseEvent) => {
    if (!hasMenu) return
    suppressClick.current = true
    navigator.vibrate?.(10)
    onOpenMenu(event.clientX, event.clientY)
  })

  return (
    <div
      {...longPress}
      onClickCapture={(event) => {
        if (!suppressClick.current) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      className="group relative select-none rounded-2xl border border-border-subtle bg-surface/70 p-4 transition-colors [-webkit-touch-callout:none] hover:border-border"
    >
      <Link
        to={href}
        draggable={false}
        onPointerDown={() => {
          suppressClick.current = false
        }}
        className="absolute inset-0 rounded-2xl"
        aria-label={meeting.title}
      />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium" dir="auto">
              {meeting.title}
            </p>
            <MeetingStatusBadge status={meeting.status} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              {dateLabel}
            </span>
            {meeting.durationSeconds > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />
                {formatDurationShort(meeting.durationSeconds, t)}
              </span>
            ) : null}
            {meeting.actionItemCount > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckSquare className="size-3.5" />
                {t('meetings.list.actionCount', { count: meeting.actionItemCount })}
              </span>
            ) : null}
          </div>
          {meeting.summary ? (
            <p className="mt-2 line-clamp-2 text-sm text-muted" dir="auto">
              {meeting.summary}
            </p>
          ) : null}
        </div>
        {hasMenu ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
              onOpenMenu(rtl ? rect.left : rect.right - MEETING_MENU_WIDTH, rect.bottom + 4)
            }}
            className="relative z-10 rounded-lg p-2 text-muted opacity-100 transition-opacity hover:bg-surface-2 hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            aria-label={t('meetings.menu.label')}
            aria-haspopup="menu"
          >
            <MoreHorizontal className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
