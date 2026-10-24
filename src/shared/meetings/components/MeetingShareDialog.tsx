import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Globe, Link2, Loader2, RefreshCw, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getAppUrl } from '@/lib/env'
import { setMeetingShare } from '../api'
import { sha256Hex, sharedMeetingUrl } from '../shared-meeting'
import type { Meeting, MeetingOs } from '../types'

/** The plaintext link exists only on the device that created it (the server keeps a hash). */
function cacheKey(os: MeetingOs, meetingId: string) {
  return `hilm.meetingShare.${os}.${meetingId}`
}

function readCached(os: MeetingOs, meetingId: string) {
  try {
    return localStorage.getItem(cacheKey(os, meetingId))
  } catch {
    return null
  }
}

function writeCached(os: MeetingOs, meetingId: string, token: string | null) {
  try {
    if (token) localStorage.setItem(cacheKey(os, meetingId), token)
    else localStorage.removeItem(cacheKey(os, meetingId))
  } catch {
    // Private mode: the link is still shown for this session.
  }
}

export function MeetingShareDialog({
  open,
  onOpenChange,
  os,
  meeting,
  canShare,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  os: MeetingOs
  meeting: Meeting
  canShare: boolean
  onChanged: () => Promise<unknown> | void
}) {
  const { t, i18n } = useTranslation()
  const [token, setToken] = useState<string | null>(null)
  const [pending, setPending] = useState<'enable' | 'rotate' | 'disable' | null>(null)
  const enabled = Boolean(meeting.shareEnabledAt)

  // Show the cached link only if it is still the active one (it may have been rotated elsewhere).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const cached = readCached(os, meeting.id)
    if (!enabled || !cached || !meeting.shareTokenHash) {
      setToken(null)
      return
    }
    void sha256Hex(cached).then((hash) => {
      if (!cancelled) setToken(hash === meeting.shareTokenHash ? cached : null)
    })
    return () => {
      cancelled = true
    }
  }, [open, enabled, os, meeting.id, meeting.shareTokenHash])

  const url = useMemo(() => (token ? sharedMeetingUrl(getAppUrl(), token) : null), [token])
  const since = meeting.shareEnabledAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(meeting.shareEnabledAt))
    : null

  const run = async (action: 'enable' | 'rotate' | 'disable') => {
    setPending(action)
    try {
      const result = await setMeetingShare(os, meeting.id, action)
      if (result.token) {
        writeCached(os, meeting.id, result.token)
        setToken(result.token)
      }
      if (action === 'disable') {
        writeCached(os, meeting.id, null)
        setToken(null)
        toast.success(t('meetings.export.shareDialog.disabled'))
      }
      if (action === 'rotate') toast.success(t('meetings.export.shareDialog.rotated'))
      await onChanged()
    } catch {
      toast.error(t('meetings.export.shareDialog.error'))
    } finally {
      setPending(null)
    }
  }

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(message)
    } catch {
      toast.error(t('meetings.errors.copyFailed'))
    }
  }

  const nativeShare = async (value: string) => {
    try {
      await navigator.share({ title: meeting.title, url: value })
    } catch {
      // Dismissed share sheet.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('meetings.export.shareDialog.title')}</DialogTitle>
          <DialogDescription>{t('meetings.export.shareDialog.description')}</DialogDescription>
        </DialogHeader>

        {!canShare ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('meetings.export.shareDialog.noPermission')}</p>
            <Button variant="secondary" onClick={() => void copy(window.location.href, t('meetings.export.linkCopied'))}>
              <Link2 /> {t('meetings.export.shareDialog.copyInApp')}
            </Button>
          </div>
        ) : !enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('meetings.export.shareDialog.off')}</p>
            <Button onClick={() => void run('enable')} disabled={pending !== null}>
              {pending === 'enable' ? <Loader2 className="animate-spin" /> : <Globe />}
              {t('meetings.export.shareDialog.enable')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {since ? (
              <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                <span className="size-1.5 rounded-full bg-success" aria-hidden />
                {t('meetings.export.shareDialog.activeSince', { date: since })}
              </p>
            ) : null}
            {url ? (
              <div className="space-y-2">
                <Input value={url} readOnly dir="ltr" onFocus={(event) => event.currentTarget.select()} aria-label={t('meetings.export.shareDialog.copy')} />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void copy(url, t('meetings.export.shareDialog.copied'))}>
                    <Copy /> {t('meetings.export.shareDialog.copy')}
                  </Button>
                  {typeof navigator !== 'undefined' && 'share' in navigator ? (
                    <Button variant="secondary" onClick={() => void nativeShare(url)}>
                      <Share2 /> {t('meetings.export.shareDialog.nativeShare')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">{t('meetings.export.shareDialog.hiddenLink')}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
              <Button variant="secondary" size="sm" onClick={() => void run('rotate')} disabled={pending !== null}>
                {pending === 'rotate' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {t('meetings.export.shareDialog.rotate')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void run('disable')} disabled={pending !== null}>
                {pending === 'disable' ? <Loader2 className="animate-spin" /> : null}
                {t('meetings.export.shareDialog.disable')}
              </Button>
            </div>
            <p className="text-xs text-muted">{t('meetings.export.shareDialog.rotateHint')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
