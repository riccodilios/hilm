import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Copy,
  Download,
  FileText,
  Link2,
  Loader2,
  Share2,
  Trash2,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { buildMeetingMarkdown, buildMeetingSnapshot, downloadMarkdown, downloadMeetingPdf } from '../export'
import { formatDurationShort } from '../format'
import { useLinkedTasks, useMeetingDetail, useMeetingMutations } from '../hooks'
import { AiThinkingOrbs } from '@/features/ai/components/AiThinkingOrbs'
import { useMeetingRecorder } from '../recorder/recorder-context'
import type { MeetingsAdapter } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import { MeetingActionItems } from './MeetingActionItems'
import { MeetingProcessingPanel } from './MeetingProcessingPanel'
import { MeetingRecorderPanel } from './MeetingRecorderPanel'
import { MeetingSpeakersDialog } from './MeetingSpeakersDialog'
import { MeetingStatusBadge } from './MeetingStatusBadge'
import { MeetingSummarySection } from './MeetingSummarySection'
import { MeetingTranscript } from './MeetingTranscript'
import { MeetingWrapUpDialog } from './MeetingWrapUpDialog'

type DetailTab = 'summary' | 'actions' | 'transcript'

export function MeetingDetailView({ adapter, meetingId }: { adapter: MeetingsAdapter; meetingId: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const recorder = useMeetingRecorder()
  const query = useMeetingDetail(adapter, meetingId)
  const detail = query.data
  const linkedTasks = useLinkedTasks(adapter, meetingId, Boolean(detail))
  const mutations = useMeetingMutations(adapter, meetingId)
  const [tab, setTab] = useState<DetailTab | null>(null)
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null)
  const [speakersOpen, setSpeakersOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [wrapUp, setWrapUp] = useState<{ open: boolean; durationMs: number }>({ open: false, durationMs: 0 })
  const location = useLocation()
  const autoRecord = Boolean((location.state as { autoRecord?: boolean } | null)?.autoRecord)
  const clearAutoRecord = () => navigate(`${location.pathname}${location.search}`, { replace: true, state: null })

  const meeting = detail?.meeting
  const isActive = recorder.isActiveFor(meetingId)
  const defaultTab: DetailTab = meeting?.status === 'ready' ? 'summary' : 'transcript'
  const activeTab = tab ?? defaultTab

  useEffect(() => {
    if (meeting) setTitleDraft(meeting.title)
  }, [meeting])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full', timeStyle: 'short' }),
    [i18n.language],
  )

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </div>
    )
  }
  if (!detail || !meeting) {
    return (
      <EmptyState
        title={t('meetings.notFound')}
        action={
          <Button asChild>
            <Link to={adapter.listHref}>{t('meetings.backToList')}</Link>
          </Button>
        }
      />
    )
  }

  const jump = (segmentId: string) => {
    setTab('transcript')
    setFocusSegmentId(null)
    requestAnimationFrame(() => setFocusSegmentId(segmentId))
  }

  const saveTitle = async () => {
    setEditingTitle(false)
    if (!titleDraft.trim() || titleDraft.trim() === meeting.title) {
      setTitleDraft(meeting.title)
      return
    }
    try {
      await mutations.update.mutateAsync({ title: titleDraft })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.generic'))
    }
  }

  const markdown = () => buildMeetingMarkdown(detail, { projectName: adapter.projectName, t, locale: i18n.language })

  const exportPdf = async () => {
    setExporting(true)
    try {
      await downloadMeetingPdf(
        buildMeetingSnapshot(detail, {
          projectName: adapter.projectName,
          t,
          locale: i18n.language.startsWith('ar') ? 'ar' : 'en',
          generatedBy: adapter.userDisplayName ?? 'Hilm',
          os: adapter.scope.os,
          workspaceName: adapter.workspaceName,
        }),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(markdown())
      toast.success(t('meetings.export.copied'))
    } catch {
      toast.error(t('meetings.errors.copyFailed'))
    }
  }

  const share = async () => {
    const url = window.location.href
    const text = meeting.summary ?? meeting.title
    if (navigator.share) {
      try {
        await navigator.share({ title: meeting.title, text, url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('meetings.export.linkCopied'))
    } catch {
      toast.error(t('meetings.errors.copyFailed'))
    }
  }

  const doDelete = async () => {
    if (isActive) await recorder.stop()
    try {
      await mutations.remove.mutateAsync(meeting.id)
      toast.success(t('meetings.deleted'))
      navigate(adapter.listHref)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.deleteFailed'))
    }
  }

  const showRecorder = isActive || meeting.status === 'draft' || meeting.status === 'recording'
  const when = meeting.heldAt ?? meeting.startedAt ?? meeting.createdAt
  const hasContent = detail.transcript.length > 0 || meeting.status === 'ready'
  const tasks = linkedTasks.data ?? []

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Link to={adapter.listHref} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t('meetings.backTo', { project: adapter.projectName })}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            {editingTitle ? (
              <Input
                value={titleDraft}
                autoFocus
                maxLength={200}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveTitle()
                  if (event.key === 'Escape') {
                    setTitleDraft(meeting.title)
                    setEditingTitle(false)
                  }
                }}
                className="h-11 text-xl"
                dir="auto"
              />
            ) : (
              <h1
                className="break-words text-2xl font-medium tracking-tight sm:text-3xl"
                dir="auto"
                onDoubleClick={() => adapter.canEdit && setEditingTitle(true)}
              >
                {meeting.title}
              </h1>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
              <MeetingStatusBadge status={isActive ? 'recording' : meeting.status} />
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" /> {dateFormatter.format(new Date(when))}
              </span>
              {meeting.durationSeconds > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" /> {formatDurationShort(meeting.durationSeconds, t)}
                </span>
              ) : null}
              {detail.speakers.length ? (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-4" /> {t('meetings.speakers.count', { count: detail.speakers.length })}
                </span>
              ) : null}
            </div>
            {meeting.participants.length ? (
              <p className="text-xs text-muted">
                {t('meetings.fields.participants')}: {meeting.participants.join('، ')}
              </p>
            ) : null}
            {meeting.description ? (
              <p className="whitespace-pre-wrap text-sm text-muted" dir="auto">
                {meeting.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {adapter.canEdit && !editingTitle ? (
              <Button variant="ghost" size="sm" onClick={() => setEditingTitle(true)}>
                {t('meetings.rename')}
              </Button>
            ) : null}
            {detail.speakers.length && adapter.canEdit ? (
              <Button variant="secondary" size="sm" onClick={() => setSpeakersOpen(true)}>
                <Users /> {t('meetings.speakers.button')}
              </Button>
            ) : null}
            {hasContent ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => void exportPdf()} disabled={exporting}>
                  {exporting ? <Loader2 className="animate-spin" /> : <FileText />} PDF
                </Button>
                <Button variant="secondary" size="sm" onClick={() => downloadMarkdown(markdown(), meeting.title)}>
                  <Download /> {t('meetings.export.markdown')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void copySummary()} aria-label={t('meetings.export.copy')}>
                  <Copy />
                </Button>
              </>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void share()} aria-label={t('meetings.export.share')}>
              <Share2 />
            </Button>
            {adapter.canDelete(meeting) ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label={t('meetings.delete.button')}>
                <Trash2 />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {showRecorder ? (
        <MeetingRecorderPanel
          adapter={adapter}
          detail={detail}
          autoStart={autoRecord}
          onAutoStartHandled={clearAutoRecord}
          onStopped={({ firstSession, durationMs }) => {
            if (firstSession) setWrapUp({ open: true, durationMs })
          }}
        />
      ) : null}
      <MeetingProcessingPanel adapter={adapter} detail={detail} />
      {meeting.status === 'ready' && adapter.canEdit && !isActive ? (
        <MeetingRecorderPanel adapter={adapter} detail={detail} compact />
      ) : null}

      {hasContent || detail.actionItems.length ? (
        <Tabs value={activeTab} onValueChange={(value) => setTab(value as DetailTab)}>
          <TabsList>
            <TabsTrigger value="summary">{t('meetings.tabs.summary')}</TabsTrigger>
            <TabsTrigger value="actions">
              {t('meetings.tabs.actions')}
              {detail.actionItems.length ? ` (${detail.actionItems.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="transcript">{t('meetings.tabs.transcript')}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary">
            {meeting.status === 'ready' ? (
              <MeetingSummarySection detail={detail} onJump={jump} />
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                {meeting.status === 'processing' ? (
                  <AiThinkingOrbs state="thinking" size={40} label={t('meetings.summary.pending')} />
                ) : null}
                <p>{t('meetings.summary.pending')}</p>
              </div>
            )}
          </TabsContent>
          <TabsContent value="actions">
            <div className="space-y-5">
              <MeetingActionItems adapter={adapter} detail={detail} onJump={jump} />
              {tasks.length ? (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted">
                    <Link2 className="size-4" /> {t('meetings.linkedTasks.title')}
                  </h3>
                  <ul className="space-y-1.5">
                    {tasks.map((task) => (
                      <li key={task.id}>
                        <Link
                          to={adapter.tasks.taskHref(task.id)}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface/60 px-3 py-2 text-sm hover:border-border"
                        >
                          <span className="truncate" dir="auto">
                            {task.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted">{t(`status.${task.status}`, { defaultValue: task.status })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </TabsContent>
          <TabsContent value="transcript">
            <MeetingTranscript detail={detail} focusSegmentId={focusSegmentId} canPlay={detail.audio.length > 0} />
          </TabsContent>
        </Tabs>
      ) : null}

      <MeetingWrapUpDialog
        open={wrapUp.open}
        onOpenChange={(open) => setWrapUp((prev) => ({ ...prev, open }))}
        meeting={meeting}
        durationMs={wrapUp.durationMs}
        onSave={async (patch) => {
          await mutations.update.mutateAsync(patch)
        }}
      />
      <MeetingSpeakersDialog open={speakersOpen} onOpenChange={setSpeakersOpen} adapter={adapter} detail={detail} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('meetings.delete.title')}
        description={t('meetings.delete.description')}
        confirmLabel={t('meetings.delete.confirm')}
        destructive
        pending={mutations.remove.isPending}
        onConfirm={() => void doDelete()}
      />
    </div>
  )
}
