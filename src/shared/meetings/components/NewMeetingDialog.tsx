import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Meeting } from '../types'

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function NewMeetingDialog({
  open,
  onOpenChange,
  projectName,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  onCreate: (input: { title: string; description: string | null; heldAt: string; participants: string[] }) => Promise<Meeting>
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [heldAt, setHeldAt] = useState(() => localDateTimeValue())
  const [participants, setParticipants] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setTitle('')
    setDescription('')
    setHeldAt(localDateTimeValue())
    setParticipants('')
  }

  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || null,
        heldAt: heldAt ? new Date(heldAt).toISOString() : new Date().toISOString(),
        participants: participants
          .split(/[,،\n]/)
          .map((name) => name.trim())
          .filter(Boolean),
      })
      reset()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('meetings.errors.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('meetings.new.title')}</DialogTitle>
          <DialogDescription>{t('meetings.new.description', { project: projectName })}</DialogDescription>
        </DialogHeader>
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
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('meetings.fields.titlePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meeting-held-at">{t('meetings.fields.date')}</Label>
            <Input
              id="meeting-held-at"
              type="datetime-local"
              value={heldAt}
              onChange={(event) => setHeldAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meeting-participants">{t('meetings.fields.participants')}</Label>
            <Input
              id="meeting-participants"
              value={participants}
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
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('meetings.fields.descriptionPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {t('meetings.new.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
