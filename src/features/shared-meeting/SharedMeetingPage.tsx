import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarDays, CheckCircle2, CircleHelp, Clock, Link2Off, Loader2, Users } from 'lucide-react'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchSharedMeeting } from '@/shared/meetings/api'
import { MeetingSummarySection } from '@/shared/meetings/components/MeetingSummarySection'
import { MeetingTranscript } from '@/shared/meetings/components/MeetingTranscript'
import { formatClock, formatDurationShort, speakerName } from '@/shared/meetings/format'
import { isSafeMeetingAppHref, mapSharedMeeting, SHARE_TOKEN_RE } from '@/shared/meetings/shared-meeting'
import type { MeetingDetail } from '@/shared/meetings/types'

type PageState =
  | { kind: 'loading' }
  | { kind: 'opening' }
  | { kind: 'ready'; detail: MeetingDetail }
  | { kind: 'not_found' | 'rate_limited' | 'error' }

type Tab = 'transcript' | 'summary' | 'actions'

/** Private transcripts: keep the page out of search engines and the token out of Referer headers. */
function usePrivatePageMeta(title: string | null) {
  useEffect(() => {
    // index.html ships "index, follow" for the landing page; override it rather than add a second tag.
    const restore: Array<() => void> = []
    for (const [name, content] of [
      ['robots', 'noindex, nofollow, noarchive'],
      ['referrer', 'no-referrer'],
    ] as const) {
      let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
      if (tag) {
        const previous = tag.content
        tag.content = content
        const existing = tag
        restore.push(() => {
          existing.content = previous
        })
      } else {
        tag = Object.assign(document.createElement('meta'), { name, content })
        document.head.appendChild(tag)
        const added = tag
        restore.push(() => added.remove())
      }
    }
    return () => restore.forEach((undo) => undo())
  }, [])
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = `${title} · Hilm`
    return () => {
      document.title = previous
    }
  }, [title])
}

export function SharedMeetingPage() {
  const { token = '' } = useParams()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<Tab>('transcript')
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null)
  usePrivatePageMeta(state.kind === 'ready' ? state.detail.meeting.title : null)

  useEffect(() => {
    // Wait for the session so a signed-in member can be taken straight into the app.
    if (authLoading) return
    if (!SHARE_TOKEN_RE.test(token)) {
      setState({ kind: 'not_found' })
      return
    }
    let cancelled = false
    setState({ kind: 'loading' })
    void fetchSharedMeeting(token).then((result) => {
      if (cancelled) return
      if (result.status !== 'ok') {
        setState({ kind: result.status })
        return
      }
      if (user && isSafeMeetingAppHref(result.appHref)) {
        setState({ kind: 'opening' })
        navigate(result.appHref, { replace: true })
        return
      }
      const detail = mapSharedMeeting(result.payload)
      setState(detail ? { kind: 'ready', detail } : { kind: 'error' })
    })
    return () => {
      cancelled = true
    }
  }, [authLoading, token, user, navigate, attempt])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full', timeStyle: 'short' }),
    [i18n.language],
  )

  const jump = (segmentId: string) => {
    setTab('transcript')
    setFocusSegmentId(null)
    requestAnimationFrame(() => setFocusSegmentId(segmentId))
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('brand.name')}</p>
            <p className="text-xs text-muted">{t('sharedMeeting.sharedVia')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            {user ? (
              <Button asChild variant="secondary" size="sm">
                <Link to="/personal">{t('sharedMeeting.openHilm')}</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to="/signup">{t('sharedMeeting.join')}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        {state.kind === 'loading' || state.kind === 'opening' ? (
          <div className="space-y-4" aria-busy="true">
            <p className="inline-flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" />
              {state.kind === 'opening' ? t('sharedMeeting.opening') : t('sharedMeeting.loading')}
            </p>
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : state.kind === 'ready' ? (
          <SharedMeetingContent
            detail={state.detail}
            tab={tab}
            onTabChange={setTab}
            onJump={jump}
            focusSegmentId={focusSegmentId}
            dateLabel={state.detail.meeting.heldAt ? dateFormatter.format(new Date(state.detail.meeting.heldAt)) : null}
          />
        ) : (
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-border-subtle bg-surface/70 p-6 text-center">
            {state.kind === 'not_found' ? (
              <Link2Off className="mx-auto size-8 text-muted" aria-hidden />
            ) : (
              <AlertTriangle className="mx-auto size-8 text-warning" aria-hidden />
            )}
            <h1 className="mt-3 text-lg font-medium">
              {state.kind === 'not_found' ? t('sharedMeeting.notFoundTitle') : t('sharedMeeting.errorTitle')}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {state.kind === 'not_found'
                ? t('sharedMeeting.notFoundBody')
                : state.kind === 'rate_limited'
                  ? t('sharedMeeting.rateLimited')
                  : t('meetings.errors.generic')}
            </p>
            {state.kind !== 'not_found' ? (
              <Button className="mt-4" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
                {t('sharedMeeting.retry')}
              </Button>
            ) : null}
          </div>
        )}

        {!user && state.kind !== 'loading' && state.kind !== 'opening' ? (
          <aside className="mt-10 rounded-2xl border border-border-subtle bg-surface/60 p-5 text-center">
            <p className="font-medium">{t('sharedMeeting.joinTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t('sharedMeeting.joinBody')}</p>
            <Button asChild className="mt-4" variant="secondary">
              <Link to="/signup">{t('sharedMeeting.join')}</Link>
            </Button>
          </aside>
        ) : null}
      </main>
    </div>
  )
}

function SharedMeetingContent({
  detail,
  tab,
  onTabChange,
  onJump,
  focusSegmentId,
  dateLabel,
}: {
  detail: MeetingDetail
  tab: Tab
  onTabChange: (tab: Tab) => void
  onJump: (segmentId: string) => void
  focusSegmentId: string | null
  dateLabel: string | null
}) {
  const { t } = useTranslation()
  const { meeting } = detail
  return (
    <article className="space-y-5">
      <div className="space-y-2">
        <h1 className="break-words text-2xl font-medium tracking-tight sm:text-3xl" dir="auto">
          {meeting.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
          {dateLabel ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" /> {dateLabel}
            </span>
          ) : null}
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
          <span className="rounded-full border border-border-subtle px-2 py-0.5 text-xs">{t('sharedMeeting.readOnly')}</span>
        </div>
        {meeting.participants.length ? (
          <p className="text-xs text-muted" dir="auto">
            {t('meetings.fields.participants')}: {meeting.participants.join('، ')}
          </p>
        ) : null}
        {meeting.status !== 'ready' ? (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{t('sharedMeeting.processing')}</p>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(value) => onTabChange(value as Tab)}>
        <TabsList>
          <TabsTrigger value="transcript">{t('meetings.tabs.transcript')}</TabsTrigger>
          <TabsTrigger value="summary">{t('meetings.tabs.summary')}</TabsTrigger>
          <TabsTrigger value="actions">
            {t('meetings.tabs.actions')}
            {detail.actionItems.length ? ` (${detail.actionItems.length})` : ''}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="transcript">
          <MeetingTranscript detail={detail} focusSegmentId={focusSegmentId} canPlay={false} />
        </TabsContent>
        <TabsContent value="summary">
          <MeetingSummarySection detail={detail} onJump={onJump} />
        </TabsContent>
        <TabsContent value="actions">
          <SharedActionItems detail={detail} onJump={onJump} />
        </TabsContent>
      </Tabs>
    </article>
  )
}

function SharedActionItems({ detail, onJump }: { detail: MeetingDetail; onJump: (segmentId: string) => void }) {
  const { t } = useTranslation()
  const speakers = new Map(detail.speakers.map((speaker) => [speaker.id, speaker]))
  const segments = new Map(detail.transcript.map((segment) => [segment.id, segment]))
  if (!detail.actionItems.length) return <p className="text-sm text-muted">{t('sharedMeeting.noActions')}</p>
  return (
    <ul className="space-y-2">
      {detail.actionItems.map((item) => {
        const owner = item.ownerSpeakerId ? speakers.get(item.ownerSpeakerId) : undefined
        const source = item.sourceSegmentIds.map((id) => segments.get(id)).find((segment) => segment !== undefined)
        return (
          <li key={item.id} className="rounded-xl border border-border-subtle bg-surface/60 p-3">
            <div className="flex items-start gap-2">
              {item.certainty === 'confirmed' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-warning" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium leading-6" dir="auto" style={{ unicodeBidi: 'isolate' }}>
                  {item.title}
                </p>
                {item.description ? (
                  <p className="text-sm text-muted" dir="auto" style={{ unicodeBidi: 'isolate' }}>
                    {item.description}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {owner ? (
                    <span>
                      {t('sharedMeeting.owner')}: <bdi>{speakerName(owner, owner.label)}</bdi>
                    </span>
                  ) : null}
                  {item.dueText || item.dueDate ? (
                    <span>
                      {t('sharedMeeting.due')}: <bdi>{item.dueText ?? item.dueDate}</bdi>
                    </span>
                  ) : null}
                  {source ? (
                    <button
                      type="button"
                      onClick={() => onJump(source.id)}
                      className="rounded-md bg-surface-2 px-1.5 py-0.5 tabular-nums hover:text-foreground"
                    >
                      {formatClock(source.startMs)}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
