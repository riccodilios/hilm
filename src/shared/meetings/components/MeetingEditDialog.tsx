import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Meeting } from '../types'
import type { MeetingPatch } from '../api'
import { toLocalInputValue } from '../format'

export function MeetingEditDialog({
  meeting,
  onOpenChange,
  onSave,
}: {
  meeting: Meeting | null
  onOpenChange: (open: boolean) => void
  onSave: (patch: MeetingPatch) => Promise<void>
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [heldAt, setHeldAt] = useState('')
  const [participants, setParticipants] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!meeting) return
    setTitle(meeting.title)
    setHeldAt(toLocalInputValue(meeting.heldAt ?? meeting.startedAt ?? meeting.createdAt))
    setParticipants(meeting.participants.join(', '))
    setDescription(meeting.description ?? '')
    // Only reset when a different meeting opens, not on background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting?.id])

  const submit = async () => {
    if (!meeting || !title.trim() || saving) return
    setSaving(true)
    try {
      const held = heldAt ? new Date(heldAt) : null
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        participants: participants
          .split(/[,،\n]/)
          .map((name) => name.trim())
          .filter(Boolean),
        ...(held && !Number.isNaN(held.getTime()) ? { heldAt: held.toISOString() } : {}),
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(meeting)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('meetings.edit.title')}</DialogTitle>
          <DialogDescription>{t('meetings.edit.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="meeting-edit-title">{t('meetings.fields.title')}</Label>
            <Input
              id="meeting-edit-title"
              value={title}
              autoFocus
              maxLength={200}
              dir="auto"
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('meetings.fields.titlePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meeting-edit-date">{t('meetings.fields.date')}</Label>
            <Input
              id="meeting-edit-date"
              type="datetime-local"
              value={heldAt}
              onChange={(event) => setHeldAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meeting-edit-participants">{t('meetings.fields.participants')}</Label>
            <Input
              id="meeting-edit-participants"
              value={participants}
              dir="auto"
              onChange={(event) => setParticipants(event.target.value)}
              placeholder={t('meetings.fields.participantsPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meeting-edit-description">{t('meetings.fields.description')}</Label>
            <Textarea
              id="meeting-edit-description"
              value={description}
              rows={3}
              dir="auto"
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('meetings.fields.descriptionPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
