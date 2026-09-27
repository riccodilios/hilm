import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, Pause, Play, Square } from 'lucide-react'
import { AiThinkingOrbs } from '@/features/ai/components/AiThinkingOrbs'
import { cn } from '@/lib/utils'
import { formatClock } from '../format'
import { useMeetingRecorder } from './recorder-context'

/** Floating control shown while a meeting is recording and the user is on another page. */
export function MeetingRecorderDock() {
  const { t } = useTranslation()
  const location = useLocation()
  const recorder = useMeetingRecorder()
  const { session, status } = recorder

  if (!session || status === 'idle') return null
  if (location.pathname === session.href) return null

  const recording = status === 'recording'
  return (
    <div
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center px-3 xl:bottom-6"
      role="region"
      aria-label={t('meetings.recorder.dockLabel')}
    >
      <div className="flex w-full max-w-md items-center gap-2 rounded-2xl border border-border bg-surface/95 p-2 ps-3 shadow-2xl backdrop-blur-xl">
        <span className="relative shrink-0" aria-hidden>
          <AiThinkingOrbs
            state={recording ? 'executing' : status === 'finishing' ? 'finalizing' : 'idle'}
            size={28}
            speed={recording ? 0.6 + recorder.level * 2.4 : 1}
            paused={status === 'paused'}
          />
          <span
            className={cn(
              'absolute -end-0.5 -top-0.5 size-2 rounded-full ring-2 ring-surface',
              recording ? 'animate-pulse bg-danger' : 'bg-warning',
            )}
          />
        </span>
        <Link to={session.href} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{session.title}</span>
          <span className="block text-xs tabular-nums text-muted">
            {status === 'finishing'
              ? t('meetings.recorder.finishing')
              : `${recording ? t('meetings.recorder.recording') : t('meetings.recorder.paused')} · ${formatClock(recorder.elapsedMs)}`}
          </span>
        </Link>
        {status === 'finishing' || status === 'requesting' ? (
          <Loader2 className="size-4 animate-spin text-muted" />
        ) : (
          <>
            <button
              type="button"
              onClick={() => (recording ? recorder.pause() : void recorder.resume())}
              className="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-foreground hover:bg-surface-3"
              aria-label={recording ? t('meetings.recorder.pause') : t('meetings.recorder.resume')}
            >
              {recording ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => void recorder.stop()}
              className="flex size-9 items-center justify-center rounded-xl bg-danger/15 text-danger hover:bg-danger/25"
              aria-label={t('meetings.recorder.stop')}
            >
              <Square className="size-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
