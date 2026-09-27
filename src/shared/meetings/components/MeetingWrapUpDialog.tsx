import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarDays, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDurationShort } from '../format'
import type { Meeting } from '../types'
import type { MeetingPatch } from '../api'

/** Shown when a meeting ends: name it and add context while transcription runs in the background. */
export function MeetingWrapUpDialog({
  open,
  onOpenChange,
  meeting,
  durationMs,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  meeting: Meeting
  durationMs: number
  onSave: (patch: MeetingPatch) => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const [title, setTitle] = useState(meeting.title)
  const [participants, setParticipants] = useState(meeting.participants.join(', '))
  const [description, setDescription] = useState(meeting.description ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(meeting.title)
    setParticipants(meeting.participants.join(', '))
    setDescription(meeting.description ?? '')
    // Only reset when the dialog opens, not on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const startedLabel = useMemo(() => {
    const when = meeting.heldAt ?? meeting.startedAt ?? meeting.createdAt
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(when))
  }, [i18n.language, meeting.createdAt, meeting.heldAt, meeting.startedAt])

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        participants: participants
          .split(/[,،\n]/)
          .map((name) => name.trim())
          .filter(Boolean),
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('meetings.wrapUp.title')}</DialogTitle>
          <DialogDescription>{t('meetings.wrapUp.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-surface-2/60 px-3 py-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5" /> {t('meetings.wrapUp.startedAt', { time: startedLabel })}
          </span>
          {durationMs >= 1000 ? (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" /> {formatDurationShort(Math.round(durationMs / 1000), t)}
            </span>
          ) : null}
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="meeting-title">{t('meetings.fields.title')}</Label>
            <Input
              id="meeting-title"
              value={title}
              autoFocus
              maxLength={200}
              dir="auto"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('meetings.fields.titlePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meeting-participants">{t('meetings.fields.participants')}</Label>
            <Input
              id="meeting-participants"
              value={participants}
              dir="auto"
              onChange={(event) => setParticipants(event.target.value)}
              placeholder={t('meetings.fields.participantsPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meeting-description">{t('meetings.fields.description')}</Label>
            <Textarea
              id="meeting-description"
              value={description}
              rows={3}
              dir="auto"
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('meetings.fields.descriptionPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('meetings.wrapUp.skip')}
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {t('meetings.wrapUp.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
