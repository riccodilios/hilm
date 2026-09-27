import { useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Mic, Pause, Play, ShieldCheck, Square, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AiThinkingOrbs, type ThinkingOrbState } from '@/features/ai/components/AiThinkingOrbs'
import { cn } from '@/lib/utils'
import { finalizeRecording, meetingStoragePath } from '../api'
import { formatClock } from '../format'
import { useMeetingMutations, useMeetingQuota } from '../hooks'
import { isRecordingSupported } from '../recorder/capture'
import { useMeetingRecorder } from '../recorder/recorder-context'
import type { MeetingDetail, MeetingsAdapter } from '../types'

function nextPart(detail: MeetingDetail) {
  const last = detail.audio.reduce<MeetingDetail['audio'][number] | null>(
    (acc, part) => (!acc || part.idx > acc.idx ? part : acc),
    null,
  )
  return {
    startIdx: last ? last.idx + 1 : 0,
    startOffsetMs: last ? last.offsetMs + last.durationMs : 0,
  }
}

export function MeetingRecorderPanel({
  adapter,
  detail,
  compact,
}: {
  adapter: MeetingsAdapter
  detail: MeetingDetail
  /** Smaller layout used for "record more" on finished meetings. */
  compact?: boolean
}) {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const recorder = useMeetingRecorder()
  const quota = useMeetingQuota()
  const mutations = useMeetingMutations(adapter, detail.meeting.id)
  const { meeting } = detail
  const active = recorder.isActiveFor(meeting.id)
  const otherActive = recorder.status !== 'idle' && !active && recorder.session
  const supported = isRecordingSupported()

  const quotaData = quota.data
  const monthlyLeftMs = quotaData
    ? Math.max(0, (quotaData.minutesPerMonth - quotaData.usedMinutesMonth) * 60_000)
    : null
  const quotaBlocked = Boolean(quotaData && (!quotaData.enabled || (monthlyLeftMs !== null && monthlyLeftMs < 30_000)))

  const startRecording = async () => {
    const { startIdx, startOffsetMs } = nextPart(detail)
    const maxMs = quotaData
      ? Math.min(quotaData.maxMinutes * 60_000, startOffsetMs + (monthlyLeftMs ?? Number.POSITIVE_INFINITY))
      : null
    if (maxMs !== null && startOffsetMs >= maxMs - 5_000) {
      toast.error(t('meetings.recorder.errors.meeting_too_long'))
      return
    }
    await recorder.start({
      os: adapter.scope.os,
      meetingId: meeting.id,
      title: meeting.title,
      href: location.pathname,
      storagePathFor: (idx) => meetingStoragePath(adapter.scope, meeting.id, idx),
      startIdx,
      startOffsetMs,
      maxMs,
      locale: i18n.language,
    })
  }

  const finishInterrupted = async () => {
    try {
      await finalizeRecording(adapter.scope.os, meeting.id, {
        expectedSegments: detail.audio.length,
        durationSeconds: nextPart(detail).startOffsetMs / 1000,
      })
      if (recorder.interrupted?.meetingId === meeting.id) recorder.clearInterrupted()
      await mutations.invalidate()
      if (detail.audio.length) recorder.driveProcessing(adapter.scope.os, meeting.id, i18n.language)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.generic'))
    }
  }

  const errorBanner = recorder.error ? (
    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm" role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex-1">
        <p className="font-medium">{t(`meetings.recorder.errors.${recorder.error.code}`)}</p>
        {recorder.error.code === 'permission_denied' ? (
          <p className="mt-1 text-muted">{t('meetings.recorder.errors.permissionHelp')}</p>
        ) : null}
      </div>
      <button type="button" className="text-xs text-muted hover:text-foreground" onClick={recorder.clearError}>
        {t('common.dismiss')}
      </button>
    </div>
  ) : null

  if (!adapter.canEdit) return null

  if (otherActive && recorder.session) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface/70 p-4 text-sm text-muted">
        {t('meetings.recorder.otherActive')}{' '}
        <Link className="text-foreground underline" to={recorder.session.href}>
          {recorder.session.title}
        </Link>
      </div>
    )
  }

  if (active) {
    const recording = recorder.status === 'recording'
    const statusLabel =
      recorder.status === 'requesting'
        ? t('meetings.recorder.requesting')
        : recorder.status === 'finishing'
          ? t('meetings.recorder.finishing')
          : recording
            ? t('meetings.recorder.recording')
            : t('meetings.recorder.paused')
    const orbState: ThinkingOrbState =
      recorder.status === 'requesting'
        ? 'thinking'
        : recorder.status === 'finishing'
          ? 'finalizing'
          : recording
            ? 'executing'
            : 'idle'
    return (
      <div className="space-y-3 rounded-2xl border border-danger/25 bg-surface/80 p-4 sm:p-5">
        {errorBanner}
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex size-16 items-center justify-center">
            <span
              className={cn(
                'absolute inset-1 rounded-full bg-danger/15 transition-transform duration-150',
                recording ? 'opacity-100' : 'opacity-30',
              )}
              style={{ transform: `scale(${1 + (recording ? recorder.level : 0) * 0.5})` }}
              aria-hidden
            />
            <AiThinkingOrbs
              state={orbState}
              size={64}
              speed={recording ? 0.6 + recorder.level * 2.4 : 1}
              paused={recorder.status === 'paused'}
              label={statusLabel}
              className="relative"
            />
            <span
              className={cn(
                'absolute end-1 top-1 size-2.5 rounded-full ring-2 ring-surface',
                recording ? 'animate-pulse bg-danger' : 'bg-warning',
              )}
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-3xl font-medium tabular-nums tracking-tight" aria-live="polite">
              {formatClock(recorder.elapsedMs)}
            </p>
            <p className="text-xs text-muted">{statusLabel}</p>
          </div>
          <div className="flex gap-2">
            {recorder.status === 'finishing' || recorder.status === 'requesting' ? (
              <Loader2 className="size-5 animate-spin text-muted" />
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => (recording ? recorder.pause() : void recorder.resume())}
                  aria-label={recording ? t('meetings.recorder.pause') : t('meetings.recorder.resume')}
                >
                  {recording ? <Pause /> : <Play />}
                  <span className="hidden sm:inline">
                    {recording ? t('meetings.recorder.pause') : t('meetings.recorder.resume')}
                  </span>
                </Button>
                <Button variant="destructive" onClick={() => void recorder.stop()}>
                  <Square /> {t('meetings.recorder.stop')}
                </Button>
              </>
            )}
          </div>
        </div>
        {recorder.notice ? (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            {t(`meetings.recorder.notice.${recorder.notice}`)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <UploadCloud className="size-3.5" />
            {recorder.pendingUploads > 0
              ? t('meetings.recorder.pendingUploads', { count: recorder.pendingUploads })
              : t('meetings.recorder.allSaved')}
          </span>
          <span>{t('meetings.recorder.keepOpen')}</span>
        </div>
      </div>
    )
  }

  if (meeting.status === 'recording') {
    return (
      <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium">{t('meetings.recorder.interruptedTitle')}</p>
            <p className="mt-1 text-sm text-muted">
              {t('meetings.recorder.interruptedDescription', { count: detail.audio.length })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void startRecording()} disabled={!supported || quotaBlocked}>
            <Mic /> {t('meetings.recorder.continue')}
          </Button>
          <Button variant="secondary" onClick={() => void finishInterrupted()}>
            {t('meetings.recorder.finishNow')}
          </Button>
        </div>
        {errorBanner}
      </div>
    )
  }

  if (compact) {
    return (
      <div className="space-y-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void startRecording()}
          disabled={!supported || quotaBlocked || meeting.status === 'processing'}
        >
          <Mic /> {t('meetings.recorder.recordMore')}
        </Button>
        {errorBanner}
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border-subtle bg-surface/70 p-5 text-center sm:p-8">
      {errorBanner}
      <button
        type="button"
        onClick={() => void startRecording()}
        disabled={!supported || quotaBlocked || recorder.status !== 'idle'}
        className="mx-auto flex size-20 items-center justify-center rounded-full bg-danger text-white shadow-lg shadow-danger/20 transition-transform hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        aria-label={t('meetings.recorder.start')}
      >
        <Mic className="size-8" />
      </button>
      <div>
        <p className="font-medium">{t('meetings.recorder.start')}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          {!supported
            ? t('meetings.recorder.errors.unsupported')
            : quotaBlocked
              ? t('meetings.recorder.errors.monthly_meeting_limit')
              : t('meetings.recorder.startHint')}
        </p>
        {quotaData ? (
          <p className="mt-2 text-xs text-muted">
            {t('meetings.recorder.quota', {
              max: quotaData.maxMinutes,
              used: Math.round(quotaData.usedMinutesMonth),
              month: quotaData.minutesPerMonth,
            })}
          </p>
        ) : null}
      </div>
      <p className="mx-auto flex max-w-md items-start justify-center gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        {t('meetings.recorder.consent')}
      </p>
    </div>
  )
}
