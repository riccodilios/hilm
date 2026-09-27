import { useEffect, useRef } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Mic, Pause, Play, ShieldCheck, Square, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AiAmbientBackground } from '@/features/ai/components/AiAmbientBackground'
import { AiThinkingOrbs, type ThinkingOrbState } from '@/features/ai/components/AiThinkingOrbs'
import { cn } from '@/lib/utils'
import { finalizeRecording, meetingStoragePath } from '../api'
import { formatClock } from '../format'
import { useMeetingMutations, useMeetingQuota } from '../hooks'
import { isRecordingSupported } from '../recorder/capture'
import { useMeetingRecorder } from '../recorder/recorder-context'
import { useVoiceActivity } from '../recorder/useVoiceActivity'
import type { MeetingDetail, MeetingsAdapter } from '../types'

export type RecordingStoppedInfo = { firstSession: boolean; durationMs: number }

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

/** Soft, low-opacity blur that swells with the speaker's voice behind the orb. */
function LiveBackdrop({ level, speaking }: { level: number; speaking: boolean }) {
  const energy = Math.min(1, level * 3)
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden>
      <AiAmbientBackground intensity={speaking ? 0.55 + energy * 0.4 : 0.3} />
      <div
        className="absolute left-1/2 top-[38%] size-64 rounded-full bg-foreground blur-3xl transition-[opacity,transform] duration-700 ease-out sm:size-80"
        style={{
          opacity: speaking ? 0.05 + energy * 0.07 : 0.025,
          transform: `translate(-50%, -50%) scale(${speaking ? 0.95 + energy * 0.45 : 0.8})`,
        }}
      />
      <div
        className="absolute left-[58%] top-[44%] size-48 rounded-full bg-info blur-3xl transition-[opacity,transform] duration-1000 ease-out"
        style={{
          opacity: speaking ? 0.04 + energy * 0.05 : 0.015,
          transform: `translate(-50%, -50%) scale(${speaking ? 1 + energy * 0.35 : 0.85})`,
        }}
      />
    </div>
  )
}

export function MeetingRecorderPanel({
  adapter,
  detail,
  compact,
  autoStart,
  onAutoStartHandled,
  onStopped,
}: {
  adapter: MeetingsAdapter
  detail: MeetingDetail
  /** Smaller layout used for "record more" on finished meetings. */
  compact?: boolean
  /** Start recording as soon as the panel is ready (used right after creating a meeting). */
  autoStart?: boolean
  onAutoStartHandled?: () => void
  onStopped?: (info: RecordingStoppedInfo) => void
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
  const recording = active && recorder.status === 'recording'
  const voice = useVoiceActivity(recorder.level, recording)
  const autoStartedRef = useRef(false)

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
    const startedAt = new Date().toISOString()
    const started = await recorder.start({
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
    // The meeting time is when the first recording actually started.
    if (started && startIdx === 0) {
      await mutations.update.mutateAsync({ heldAt: startedAt }).catch(() => undefined)
    }
  }

  const endMeeting = async () => {
    const firstSession = recorder.session?.startIdx === 0
    const durationMs = recorder.elapsedMs
    await recorder.stop()
    onStopped?.({ firstSession, durationMs })
  }

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return
    if (meeting.status !== 'draft' || recorder.status !== 'idle' || !adapter.canEdit) {
      autoStartedRef.current = true
      onAutoStartHandled?.()
      return
    }
    if (quota.isLoading) return
    autoStartedRef.current = true
    onAutoStartHandled?.()
    if (supported && !quotaBlocked) void startRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, meeting.status, recorder.status, quota.isLoading, quotaBlocked, supported, adapter.canEdit])

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
    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-start text-sm" role="alert">
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
    const statusLabel =
      recorder.status === 'requesting'
        ? t('meetings.recorder.requesting')
        : recorder.status === 'finishing'
          ? t('meetings.recorder.finishing')
          : recording
            ? voice.speaking
              ? t('meetings.recorder.speaking')
              : t('meetings.recorder.listening')
            : t('meetings.recorder.paused')
    const orbState: ThinkingOrbState =
      recorder.status === 'requesting'
        ? 'thinking'
        : recorder.status === 'finishing'
          ? 'finalizing'
          : recording && voice.speaking
            ? 'executing'
            : 'idle'
    const busy = recorder.status === 'finishing' || recorder.status === 'requesting'
    return (
      <div className="relative overflow-hidden rounded-3xl border border-border-subtle bg-surface/70">
        <LiveBackdrop level={voice.level} speaking={recording && voice.speaking} />
        <div className="relative flex flex-col items-center gap-5 px-4 pb-6 pt-8 sm:pt-10">
          {errorBanner ? <div className="w-full max-w-md">{errorBanner}</div> : null}
          <AiThinkingOrbs
            state={orbState}
            size={176}
            speed={recording && voice.speaking ? 0.8 + Math.min(1, voice.level * 3) * 1.6 : 1}
            paused={recorder.status === 'paused'}
            label={statusLabel}
          />
          <div className="text-center">
            <p className="text-4xl font-medium tabular-nums tracking-tight" aria-live="off">
              {formatClock(recorder.elapsedMs)}
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  recording ? 'animate-pulse bg-danger' : recorder.status === 'paused' ? 'bg-warning' : 'bg-muted',
                )}
                aria-hidden
              />
              {statusLabel}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            {busy ? (
              <Loader2 className="size-5 animate-spin text-muted" />
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  className="rounded-full"
                  onClick={() => (recording ? recorder.pause() : void recorder.resume())}
                >
                  {recording ? <Pause /> : <Play />}
                  {recording ? t('meetings.recorder.pause') : t('meetings.recorder.resume')}
                </Button>
                <Button variant="destructive" size="lg" className="rounded-full" onClick={() => void endMeeting()}>
                  <Square /> {t('meetings.recorder.stop')}
                </Button>
              </>
            )}
          </div>
          {recorder.notice ? (
            <p className="max-w-md rounded-lg bg-warning/10 px-3 py-2 text-center text-xs text-warning">
              {t(`meetings.recorder.notice.${recorder.notice}`)}
            </p>
          ) : null}
        </div>
        <div className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border-subtle px-4 py-3 text-center text-xs text-muted">
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

  const canStart = supported && !quotaBlocked && recorder.status === 'idle'
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border-subtle bg-surface/70 px-4 pb-6 pt-8 text-center sm:pt-10">
      <AiAmbientBackground intensity={0.3} />
      <div className="relative space-y-4">
        {errorBanner ? <div className="mx-auto max-w-md">{errorBanner}</div> : null}
        <button
          type="button"
          onClick={() => void startRecording()}
          disabled={!canStart}
          className="group relative mx-auto flex size-44 items-center justify-center rounded-full outline-none transition-transform duration-300 hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          aria-label={t('meetings.recorder.start')}
        >
          <span
            className="absolute inset-6 rounded-full bg-foreground opacity-[0.04] blur-2xl transition-opacity duration-500 group-hover:opacity-[0.1]"
            aria-hidden
          />
          <AiThinkingOrbs state="idle" size={176} label={t('meetings.recorder.start')} className="relative" />
          <Mic className="absolute size-5 text-foreground/70 transition-transform duration-300 group-hover:scale-110" aria-hidden />
        </button>
        <div>
          <p className="font-medium">{recorder.status === 'requesting' ? t('meetings.recorder.requesting') : t('meetings.recorder.tapToStart')}</p>
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
    </div>
  )
}
