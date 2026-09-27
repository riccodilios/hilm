import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleHelp, Quote } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatClock } from '../format'
import type { MeetingDetail } from '../types'

export function SourceLinks({
  ids,
  detail,
  onJump,
}: {
  ids: string[]
  detail: MeetingDetail
  onJump: (segmentId: string) => void
}) {
  const { t } = useTranslation()
  if (!ids.length) return null
  const byId = new Map(detail.transcript.map((segment) => [segment.id, segment]))
  const segments = ids.map((id) => byId.get(id)).filter((segment) => segment !== undefined).slice(0, 4)
  if (!segments.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Quote className="size-3 text-muted" aria-hidden />
      {segments.map((segment) => (
        <button
          key={segment.id}
          type="button"
          onClick={() => onJump(segment.id)}
          className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] tabular-nums text-muted hover:text-foreground"
          aria-label={t('meetings.transcript.jumpTo', { time: formatClock(segment.startMs) })}
        >
          {formatClock(segment.startMs)}
        </button>
      ))}
    </span>
  )
}

export function MeetingSummarySection({
  detail,
  onJump,
}: {
  detail: MeetingDetail
  onJump: (segmentId: string) => void
}) {
  const { t } = useTranslation()
  const { meeting, decisions } = detail

  if (!meeting.summary && !meeting.keyPoints.length && !decisions.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        {detail.transcript.length ? t('meetings.summary.empty') : t('meetings.summary.noSpeech')}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {meeting.summary ? (
        <section>
          <h3 className="mb-2 text-sm font-medium text-muted">{t('meetings.summary.title')}</h3>
          <p className="whitespace-pre-wrap text-sm leading-7" dir="auto">
            {meeting.summary}
          </p>
        </section>
      ) : null}

      {meeting.keyPoints.length ? (
        <section>
          <h3 className="mb-2 text-sm font-medium text-muted">{t('meetings.summary.keyPoints')}</h3>
          <ul className="space-y-2">
            {meeting.keyPoints.map((point, index) => (
              <li key={index} className="flex gap-2 text-sm leading-6" dir="auto">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-medium text-muted">{t('meetings.summary.decisions')}</h3>
        {decisions.length ? (
          <ul className="space-y-2">
            {decisions.map((decision) => (
              <li key={decision.id} className="rounded-xl border border-border-subtle bg-surface/60 p-3">
                <div className="flex items-start gap-2">
                  {decision.certainty === 'confirmed' ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <CircleHelp className="mt-0.5 size-4 shrink-0 text-warning" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm leading-6" dir="auto">
                      {decision.text}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {decision.certainty === 'uncertain' ? (
                        <Badge className="bg-warning/15 text-warning">{t('meetings.certainty.uncertain')}</Badge>
                      ) : null}
                      <SourceLinks ids={decision.sourceSegmentIds} detail={detail} onJump={onJump} />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('meetings.summary.noDecisions')}</p>
        )}
      </section>
    </div>
  )
}
