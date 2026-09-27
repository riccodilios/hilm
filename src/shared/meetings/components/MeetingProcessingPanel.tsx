import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AiAmbientBackground } from '@/features/ai/components/AiAmbientBackground'
import { AiThinkingOrbs, type ThinkingOrbState } from '@/features/ai/components/AiThinkingOrbs'
import { cn } from '@/lib/utils'
import { callMeetingProcess } from '../api'
import { useMeetingMutations, useMeetingQuota } from '../hooks'
import { useMeetingRecorder } from '../recorder/recorder-context'
import type { MeetingDetail, MeetingsAdapter } from '../types'

type Stage = 'upload' | 'transcribe' | 'analyze'
const STAGES: Stage[] = ['upload', 'transcribe', 'analyze']

const ORB_BY_STAGE: Record<Stage | 'waiting', ThinkingOrbState> = {
  upload: 'executing',
  transcribe: 'thinking',
  analyze: 'planning',
  waiting: 'idle',
}

const AMBIENT_BY_STAGE: Record<Stage | 'waiting', number> = {
  upload: 0.8,
  transcribe: 0.6,
  analyze: 0.7,
  waiting: 0.3,
}

function StageStepper({ current }: { current: Stage }) {
  const { t } = useTranslation()
  const currentIdx = STAGES.indexOf(current)
  return (
    <ol className="flex items-center gap-2 text-xs">
      {STAGES.map((stage, idx) => {
        const done = idx < currentIdx
        const active = idx === currentIdx
        return (
          <li key={stage} className="flex min-w-0 items-center gap-2">
            {idx > 0 ? (
              <span className={cn('h-px w-4 sm:w-8', done || active ? 'bg-foreground/40' : 'bg-border')} aria-hidden />
            ) : null}
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors',
                active && 'bg-foreground/10 font-medium text-foreground',
                done && 'text-foreground/80',
                !active && !done && 'text-muted',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="size-3" /> : null}
              {t(`meetings.processing.stages.${stage}`)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function MeetingProcessingPanel({ adapter, detail }: { adapter: MeetingsAdapter; detail: MeetingDetail }) {
  const { t, i18n } = useTranslation()
  const recorder = useMeetingRecorder()
  const quota = useMeetingQuota()
  const mutations = useMeetingMutations(adapter, detail.meeting.id)
  const [retrying, setRetrying] = useState(false)
  const [justFinished, setJustFinished] = useState(false)
  const previousStatus = useRef(detail.meeting.status)
  const { meeting, audio } = detail
  const os = adapter.scope.os
  const canDrive = adapter.canEdit

  useEffect(() => {
    if (canDrive && meeting.status === 'processing') recorder.driveProcessing(os, meeting.id, i18n.language)
    // Re-drive when a new part lands or the stage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDrive, meeting.id, meeting.status, meeting.processingStage, audio.length, os])

  useEffect(() => {
    const was = previousStatus.current
    previousStatus.current = meeting.status
    if (was === 'processing' && meeting.status === 'ready') {
      setJustFinished(true)
      const timer = window.setTimeout(() => setJustFinished(false), 4000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [meeting.status])

  if (meeting.status === 'ready' && justFinished) {
    return (
      <div
        className="ai-message-enter relative flex items-center gap-4 overflow-hidden rounded-2xl border border-success/25 bg-success/5 p-4"
        role="status"
      >
        <AiAmbientBackground intensity={0.4} />
        <AiThinkingOrbs state="complete" size={40} label={t('meetings.processing.ready')} className="relative" />
        <div className="relative">
          <p className="text-sm font-medium">{t('meetings.processing.ready')}</p>
          <p className="text-xs text-muted">{t('meetings.processing.readyHint')}</p>
        </div>
      </div>
    )
  }

  if (meeting.status === 'processing') {
    const expected = Math.max(meeting.expectedSegments ?? audio.length, audio.length)
    const transcribed = audio.filter((part) => part.status === 'transcribed').length
    const uploaded = audio.length
    const analyzing = meeting.processingStage === 'analyzing'
    const waitingQuota = meeting.processingStage === 'waiting_quota'
    const stage: Stage = analyzing ? 'analyze' : uploaded < expected ? 'upload' : 'transcribe'
    const orbKey = waitingQuota ? 'waiting' : stage
    const stageProgress = analyzing ? 1 : expected ? (stage === 'upload' ? uploaded : transcribed) / expected : 0
    const progress = Math.round(((STAGES.indexOf(stage) + stageProgress) / STAGES.length) * 100)
    const label = waitingQuota
      ? t('meetings.processing.waitingQuota')
      : analyzing
        ? t('meetings.processing.analyzing')
        : stage === 'upload'
          ? t('meetings.processing.uploading', { done: uploaded, total: expected })
          : t('meetings.processing.transcribing', { done: transcribed, total: expected })
    return (
      <div
        className="relative overflow-hidden rounded-2xl border border-border-subtle bg-surface/70 p-4 sm:p-5"
        aria-live="polite"
        role="status"
      >
        <AiAmbientBackground intensity={AMBIENT_BY_STAGE[orbKey]} />
        <div className="relative flex items-center gap-4">
          <AiThinkingOrbs state={ORB_BY_STAGE[orbKey]} size={64} label={label} />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium">{label}</p>
            <StageStepper current={stage} />
          </div>
        </div>
        <div className="relative mt-4 h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-foreground/60 transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(3, progress)}%` }}
          />
        </div>
        <p className="relative mt-2 text-xs text-muted">{t('meetings.processing.background')}</p>
      </div>
    )
  }

  if (meeting.status !== 'failed') return null

  const maxRetries = quota.data?.maxRetries ?? 3
  const retriesLeft = Math.max(0, maxRetries - meeting.processingAttempts)

  const retry = async () => {
    setRetrying(true)
    try {
      const result = await callMeetingProcess({ action: 'retry', os, meetingId: meeting.id, locale: i18n.language })
      if (!result.ok) toast.error(result.error)
      await mutations.invalidate()
      recorder.driveProcessing(os, meeting.id, i18n.language)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning/5 p-4" role="alert">
      <div className="flex items-start gap-3">
        <AiThinkingOrbs state="error" size={40} label={t('meetings.processing.failedTitle')} />
        <div>
          <p className="text-sm font-medium">{t('meetings.processing.failedTitle')}</p>
          <p className="mt-1 text-sm text-muted">{meeting.processingError || t('meetings.processing.failedDescription')}</p>
          <p className="mt-1 text-xs text-muted">{t('meetings.processing.audioSafe')}</p>
        </div>
      </div>
      {adapter.canEdit ? (
        <div className="flex items-center gap-3">
          <Button onClick={() => void retry()} disabled={retrying || retriesLeft === 0}>
            {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t('meetings.processing.retry')}
          </Button>
          <span className="text-xs text-muted">
            {retriesLeft === 0
              ? t('meetings.processing.noRetriesLeft')
              : t('meetings.processing.retriesLeft', { count: retriesLeft })}
          </span>
        </div>
      ) : null}
    </div>
  )
}
