import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileIcon, Paperclip, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type AttachmentItem = {
  id: string
  filename: string
  mime: string | null
  byte_size?: number | null
  version?: number
  url?: string | null
}

const ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mp3,.wav,.m4a,.zip,.txt,.md,.csv'

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

export function AttachmentPanel({
  items,
  uploading,
  onUpload,
  onRemove,
  onDownload,
  className,
}: {
  items: AttachmentItem[]
  uploading?: boolean
  onUpload: (files: FileList | File[]) => Promise<void> | void
  onRemove: (id: string) => Promise<void> | void
  onDownload: (item: AttachmentItem) => Promise<void> | void
  className?: string
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('attachments.title')}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          {uploading ? t('common.loading') : t('attachments.upload')}
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
            void Promise.resolve(onUpload(files)).catch((err: Error) => toast.error(err.message))
            e.target.value = ''
          }}
        />
      </div>

      {!items.length ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border-subtle px-3 py-6 text-sm text-muted">
          <Paperclip className="size-4 shrink-0" />
          {t('attachments.empty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="overflow-hidden rounded-xl border border-border-subtle bg-surface-2/30"
            >
              {item.url && isImage(item.mime) ? (
                <img src={item.url} alt={item.filename} className="max-h-48 w-full object-contain bg-black/20" />
              ) : null}
              {item.url && isVideo(item.mime) ? (
                <video src={item.url} controls className="max-h-48 w-full bg-black/20" />
              ) : null}
              {item.url && isAudio(item.mime) ? (
                <audio src={item.url} controls className="w-full px-3 pt-3" />
              ) : null}
              {item.url && isPdf(item.mime, item.filename) ? (
                <iframe title={item.filename} src={item.url} className="h-48 w-full border-0 bg-black/10" />
              ) : null}
              <div className="flex items-center gap-2 px-3 py-2">
                <FileIcon className="size-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.filename}</p>
                  <p className="text-[11px] text-muted">
                    {item.byte_size ? `${Math.round(item.byte_size / 1024)} KB` : null}
                    {item.version ? ` · v${item.version}` : null}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
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
          ))}
        </ul>
      )}
    </div>
  )
}
