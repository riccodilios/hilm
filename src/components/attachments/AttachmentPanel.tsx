import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Download, FileIcon, Paperclip, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { UploadRejectedError } from '@/lib/storage/uploads'
import { cn } from '@/lib/utils'

export type AttachmentLifecycle = {
  status: string
  expires_at: string | null
  legal_hold: boolean
  purge_after: string | null
}

export type AttachmentItem = {
  id: string
  filename: string
  mime: string | null
  byte_size?: number | null
  version?: number
  url?: string | null
  file_id?: string | null
  lifecycle?: AttachmentLifecycle | null
}

export type AttachmentRetention = { days: number | null; quarantineDays: number }

const ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mp3,.wav,.m4a,.zip,.txt,.md,.csv'

const DAY_MS = 86_400_000

function isImage(mime: string | null) {
  return Boolean(mime?.startsWith('image/'))
}
function isVideo(mime: string | null) {
  return Boolean(mime?.startsWith('video/'))
}
function isAudio(mime: string | null) {
  return Boolean(mime?.startsWith('audio/'))
}
function isPdf(mime: string | null, name: string) {
  return mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function uploadErrorMessage(t: (key: string, options?: Record<string, unknown>) => string, error: unknown) {
  if (error instanceof UploadRejectedError) {
    const maxBytes = Number(error.details.max_bytes ?? 0)
    return t(`attachments.errors.${error.code}`, {
      defaultValue: t('attachments.errors.generic'),
      size: maxBytes ? formatSize(maxBytes) : '',
    })
  }
  return error instanceof Error ? error.message : t('attachments.errors.generic')
}

export function AttachmentPanel({
  items,
  uploading,
  onUpload,
  onRemove,
  onDownload,
  onKeepLonger,
  retention,
  className,
}: {
  items: AttachmentItem[]
  uploading?: boolean
  onUpload: (files: FileList | File[]) => Promise<void> | void
  onRemove: (id: string) => Promise<void> | void
  onDownload: (item: AttachmentItem) => Promise<void> | void
  /** Shown for files the viewer may keep longer (owner, or workspace owner/admin). */
  onKeepLonger?: (item: AttachmentItem) => Promise<void> | void
  retention?: AttachmentRetention | null
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'medium' })

  const lifecycleLabel = (item: AttachmentItem) => {
    const life = item.lifecycle
    if (!life) return null
    if (life.legal_hold) return { tone: 'text-muted', text: t('attachments.lifecycle.held'), icon: ShieldCheck }
    if (life.status === 'quarantined') {
      return {
        tone: 'text-amber-500',
        text: life.purge_after
          ? t('attachments.lifecycle.quarantined', { date: formatDate(life.purge_after) })
          : t('attachments.lifecycle.quarantinedNoDate'),
        icon: CalendarClock,
      }
    }
    if (!life.expires_at) return { tone: 'text-muted', text: t('attachments.lifecycle.keptIndefinitely'), icon: ShieldCheck }
    const days = Math.ceil((Date.parse(life.expires_at) - Date.now()) / DAY_MS)
    if (days <= 7) {
      return {
        tone: 'text-amber-500',
        text: t('attachments.lifecycle.expiresIn', { count: Math.max(0, days) }),
        icon: CalendarClock,
      }
    }
    return { tone: 'text-muted', text: t('attachments.lifecycle.keptUntil', { date: formatDate(life.expires_at) }), icon: CalendarClock }
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('attachments.title')}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={uploading || pending}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          {uploading || pending ? t('common.loading') : t('attachments.upload')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = e.target.files
            if (!files?.length) return
            setPending(true)
            void Promise.resolve(onUpload(Array.from(files)))
              .catch((err: unknown) => toast.error(uploadErrorMessage(t, err)))
              .finally(() => setPending(false))
            e.target.value = ''
          }}
        />
      </div>

      {retention ? (
        <p className="text-[11px] text-muted">
          {retention.days == null
            ? t('attachments.retention.keep')
            : t('attachments.retention.notice', { days: retention.days, quarantine: retention.quarantineDays })}
        </p>
      ) : null}

      {!items.length ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border-subtle px-3 py-6 text-sm text-muted">
          <Paperclip className="size-4 shrink-0" />
          {t('attachments.empty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const label = lifecycleLabel(item)
            const unavailable = Boolean(item.lifecycle && item.lifecycle.status !== 'active')
            const canKeep =
              onKeepLonger && item.file_id && item.lifecycle?.status === 'active' && !item.lifecycle.legal_hold && item.lifecycle.expires_at
            return (
              <li key={item.id} className="overflow-hidden rounded-xl border border-border-subtle bg-surface-2/30">
                {item.url && isImage(item.mime) ? (
                  <img src={item.url} alt={item.filename} className="max-h-48 w-full object-contain bg-black/20" />
                ) : null}
                {item.url && isVideo(item.mime) ? (
                  <video src={item.url} controls className="max-h-48 w-full bg-black/20" />
                ) : null}
                {item.url && isAudio(item.mime) ? <audio src={item.url} controls className="w-full px-3 pt-3" /> : null}
                {item.url && isPdf(item.mime, item.filename) ? (
                  <iframe title={item.filename} src={item.url} className="h-48 w-full border-0 bg-black/10" />
                ) : null}
                <div className="flex items-center gap-2 px-3 py-2">
                  <FileIcon className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm', unavailable && 'text-muted line-through')}>{item.filename}</p>
                    <p className="text-[11px] text-muted">
                      {item.byte_size ? formatSize(item.byte_size) : null}
                      {item.version ? ` · v${item.version}` : null}
                    </p>
                    {label ? (
                      <p className={cn('mt-0.5 flex items-center gap-1 text-[11px]', label.tone)}>
                        <label.icon className="size-3" />
                        {label.text}
                      </p>
                    ) : null}
                  </div>
                  {canKeep ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-[11px]"
                      disabled={busyId === item.id}
                      onClick={() => {
                        setBusyId(item.id)
                        void Promise.resolve(onKeepLonger!(item))
                          .then(() => toast.success(t('attachments.lifecycle.extended')))
                          .catch((err: unknown) => toast.error(uploadErrorMessage(t, err)))
                          .finally(() => setBusyId(null))
                      }}
                    >
                      {t('attachments.lifecycle.keepLonger')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={unavailable}
                    onClick={() => void onDownload(item)}
                    aria-label={t('attachments.download')}
                  >
                    <Download className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={busyId === item.id}
                    onClick={() => {
                      setBusyId(item.id)
                      void Promise.resolve(onRemove(item.id))
                        .catch((err: Error) => toast.error(err.message))
                        .finally(() => setBusyId(null))
                    }}
                    aria-label={t('attachments.remove')}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
