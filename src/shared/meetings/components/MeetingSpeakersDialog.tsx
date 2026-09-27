import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Merge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { speakerName, speakerTone } from '../format'
import { useMeetingMutations } from '../hooks'
import type { MeetingDetail, MeetingSpeaker, MeetingsAdapter } from '../types'

function SpeakerRow({
  speaker,
  detail,
  adapter,
}: {
  speaker: MeetingSpeaker
  detail: MeetingDetail
  adapter: MeetingsAdapter
}) {
  const { t } = useTranslation()
  const mutations = useMeetingMutations(adapter, detail.meeting.id)
  const [name, setName] = useState(speaker.displayName ?? '')
  const [mergeInto, setMergeInto] = useState('')
  const lines = detail.transcript.filter((segment) => segment.speakerId === speaker.id).length

  useEffect(() => setName(speaker.displayName ?? ''), [speaker.displayName])

  const saveName = async () => {
    if ((speaker.displayName ?? '') === name.trim()) return
    try {
      await mutations.renameSpeaker.mutateAsync({ speakerId: speaker.id, displayName: name })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.generic'))
    }
  }

  const others = detail.speakers.filter((candidate) => candidate.id !== speaker.id)

  return (
    <li className="space-y-2 rounded-xl border border-border-subtle bg-surface/60 p-3">
      <div className="flex items-center gap-2">
        <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', speakerTone(speaker.ordinal))}>
          {speaker.label}
        </span>
        <span className="text-xs text-muted">{t('meetings.speakers.lines', { count: lines })}</span>
      </div>
      {speaker.description ? <p className="text-xs text-muted">{speaker.description}</p> : null}
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void saveName()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void saveName()
          }
        }}
        placeholder={t('meetings.speakers.namePlaceholder')}
        aria-label={t('meetings.speakers.rename', { label: speaker.label })}
        dir="auto"
      />
      {adapter.scope.os === 'workspace' && adapter.members?.length ? (
        <select
          value={speaker.linkedUserId ?? ''}
          onChange={(event) => {
            const member = adapter.members?.find((m) => m.id === event.target.value)
            mutations.renameSpeaker.mutate({
              speakerId: speaker.id,
              linkedUserId: event.target.value || null,
              ...(member && !name.trim() ? { displayName: member.name } : {}),
            })
          }}
          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
          aria-label={t('meetings.speakers.linkMember')}
        >
          <option value="">{t('meetings.speakers.noMember')}</option>
          {adapter.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      ) : null}
      {others.length ? (
        <div className="flex gap-2">
          <select
            value={mergeInto}
            onChange={(event) => setMergeInto(event.target.value)}
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-xs"
            aria-label={t('meetings.speakers.mergeInto')}
          >
            <option value="">{t('meetings.speakers.mergeInto')}</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {speakerName(other, other.label)}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            disabled={!mergeInto || mutations.merge.isPending}
            onClick={async () => {
              try {
                await mutations.merge.mutateAsync({ fromId: speaker.id, intoId: mergeInto })
                toast.success(t('meetings.speakers.merged'))
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t('meetings.errors.generic'))
              }
            }}
          >
            <Merge /> {t('meetings.speakers.merge')}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

export function MeetingSpeakersDialog({
  open,
  onOpenChange,
  adapter,
  detail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  adapter: MeetingsAdapter
  detail: MeetingDetail
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('meetings.speakers.title')}</DialogTitle>
          <DialogDescription>{t('meetings.speakers.description')}</DialogDescription>
        </DialogHeader>
        {detail.speakers.length ? (
          <ul className="space-y-2">
            {detail.speakers.map((speaker) => (
              <SpeakerRow key={speaker.id} speaker={speaker} detail={detail} adapter={adapter} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('meetings.speakers.empty')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
