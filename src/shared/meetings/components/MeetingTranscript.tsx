import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pause, Play, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getMeetingAudioUrl } from '../api'
import { formatClock, speakerName, speakerTone, textDirection } from '../format'
import type { MeetingDetail } from '../types'

function highlight(text: string, query: string) {
  if (!query) return text
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  const parts: Array<string | { match: string }> = []
  let index = 0
  while (index < text.length) {
    const found = lower.indexOf(needle, index)
    if (found < 0) {
      parts.push(text.slice(index))
      break
    }
    if (found > index) parts.push(text.slice(index, found))
    parts.push({ match: text.slice(found, found + needle.length) })
    index = found + needle.length
  }
  return parts.map((part, i) =>
    typeof part === 'string' ? (
      <span key={i}>{part}</span>
    ) : (
      <mark key={i} className="rounded bg-accent/30 px-0.5 text-foreground">
        {part.match}
      </mark>
    ),
  )
}

export function MeetingTranscript({
  detail,
  focusSegmentId,
  canPlay,
}: {
  detail: MeetingDetail
  focusSegmentId: string | null
  canPlay: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [speakerFilter, setSpeakerFilter] = useState<string>('all')
  const [playing, setPlaying] = useState<{ segmentId: string; loading: boolean } | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlCache = useRef(new Map<string, string>())

  const speakers = useMemo(() => new Map(detail.speakers.map((speaker) => [speaker.id, speaker])), [detail.speakers])
  const trimmed = query.trim()
  const segments = useMemo(
    () =>
      detail.transcript.filter((segment) => {
        if (speakerFilter !== 'all' && segment.speakerId !== speakerFilter) return false
        if (trimmed && !segment.text.toLowerCase().includes(trimmed.toLowerCase())) return false
        return true
      }),
    [detail.transcript, speakerFilter, trimmed],
  )

  useEffect(() => {
    if (!focusSegmentId) return
    setQuery('')
    setSpeakerFilter('all')
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`meeting-seg-${focusSegmentId}`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element?.classList.add('ring-2', 'ring-accent/60')
      window.setTimeout(() => element?.classList.remove('ring-2', 'ring-accent/60'), 1800)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusSegmentId])

  useEffect(() => () => audioRef.current?.pause(), [])

  const play = async (segmentId: string, startMs: number) => {
    const audio = audioRef.current
    if (!audio) return
    if (playing?.segmentId === segmentId && !audio.paused) {
      audio.pause()
      setPlaying(null)
      return
    }
    const part = [...detail.audio]
      .sort((a, b) => a.idx - b.idx)
      .find((candidate) => startMs >= candidate.offsetMs && startMs < candidate.offsetMs + candidate.durationMs + 500)
    if (!part) return
    setPlaying({ segmentId, loading: true })
    try {
      let url = urlCache.current.get(part.storagePath)
      if (!url) {
        url = await getMeetingAudioUrl(part.storagePath)
        urlCache.current.set(part.storagePath, url)
      }
      if (audio.src !== url) audio.src = url
      await new Promise<void>((resolve) => {
        if (audio.readyState >= 1) resolve()
        else audio.addEventListener('loadedmetadata', () => resolve(), { once: true })
      })
      audio.currentTime = Math.max(0, (startMs - part.offsetMs) / 1000)
      await audio.play()
      setPlaying({ segmentId, loading: false })
    } catch {
      setPlaying(null)
    }
  }

  if (!detail.transcript.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        {detail.meeting.status === 'ready' ? t('meetings.summary.noSpeech') : t('meetings.transcript.pending')}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('meetings.transcript.search')}
            className="ps-9"
            aria-label={t('meetings.transcript.search')}
            dir="auto"
          />
        </div>
        <select
          value={speakerFilter}
          onChange={(event) => setSpeakerFilter(event.target.value)}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm"
          aria-label={t('meetings.transcript.filterSpeaker')}
        >
          <option value="all">{t('meetings.transcript.allSpeakers')}</option>
          {detail.speakers.map((speaker) => (
            <option key={speaker.id} value={speaker.id}>
              {speakerName(speaker, speaker.label)}
            </option>
          ))}
        </select>
      </div>
      {trimmed ? (
        <p className="text-xs text-muted">{t('meetings.transcript.matches', { count: segments.length })}</p>
      ) : null}

      <audio ref={audioRef} preload="none" className="hidden" onEnded={() => setPlaying(null)} onPause={() => setPlaying((prev) => (prev?.loading ? prev : null))} />

      <ol className="space-y-1">
        {segments.map((segment) => {
          const speaker = segment.speakerId ? speakers.get(segment.speakerId) : undefined
          const isPlaying = playing?.segmentId === segment.id
          return (
            <li
              key={segment.id}
              id={`meeting-seg-${segment.id}`}
              className={cn('flex gap-3 rounded-xl px-2 py-2 transition-shadow', isPlaying && 'bg-surface-2/70')}
            >
              <button
                type="button"
                disabled={!canPlay}
                onClick={() => void play(segment.id, segment.startMs)}
                className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] tabular-nums text-muted hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none"
                aria-label={t('meetings.transcript.playFrom', { time: formatClock(segment.startMs) })}
              >
                {canPlay ? (
                  isPlaying && playing?.loading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="size-3" />
                  ) : (
                    <Play className="size-3" />
                  )
                ) : null}
                {formatClock(segment.startMs)}
              </button>
              <div className="min-w-0 flex-1">
                <span className={cn('inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium', speakerTone(speaker?.ordinal ?? 0))}>
                  {speakerName(speaker, t('meetings.transcript.unknownSpeaker'))}
                </span>
                <p className="mt-1 text-sm leading-7" dir={textDirection(segment.text)}>
                  {highlight(segment.text, trimmed)}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
