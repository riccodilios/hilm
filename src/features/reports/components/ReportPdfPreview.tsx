import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import { pdf } from '@react-pdf/renderer'
import { HilmReportDocument } from '@/features/reports/pdf/HilmReportDocument'
import type { ReportSnapshot } from '@/features/reports/types'
import { cn } from '@/lib/utils'

/**
 * Renders the report PDF via an object URL instead of PDFViewer.
 * PDFViewer silently fails when yoga WASM / fonts are blocked and remounts
 * aggressively; this path surfaces loading/errors and stays stable.
 */
export function ReportPdfPreview({
  snapshot,
  className,
}: {
  snapshot: ReportSnapshot
  className?: string
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const previewKey = `${snapshot.generatedAt}:${snapshot.title}:${snapshot.charts.length}:${snapshot.metrics.length}`

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setLoading(true)
    setError(null)
    setUrl(null)

    void (async () => {
      try {
        const blob = await pdf(<HilmReportDocument snapshot={snapshot} />).toBlob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(
          message.slice(0, 180) ||
            t('reports.previewFailed', { defaultValue: 'Couldn’t render the report preview.' }),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // snapshot identity is captured via previewKey — avoid remount thrash
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])

  return (
    <div
      className={cn(
        'relative h-[70vh] min-h-[480px] w-full overflow-hidden rounded-xl border border-border-subtle bg-white',
        className,
      )}
    >
      {loading ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/90 text-sm text-zinc-600">
          <LoaderCircle className="size-5 animate-spin" />
          {t('reports.previewLoading', { defaultValue: 'Rendering preview…' })}
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-700">
          <p className="font-medium">
            {t('reports.previewFailed', { defaultValue: 'Couldn’t render the report preview.' })}
          </p>
          <p className="max-w-md text-xs text-zinc-500">{error}</p>
          <p className="text-xs text-zinc-500">
            {t('reports.previewFailedHint', {
              defaultValue: 'Try Download PDF — generation may still succeed.',
            })}
          </p>
        </div>
      ) : null}
      {url ? (
        <iframe
          title={t('reports.stepPreview', { defaultValue: 'Preview' })}
          src={url}
          className="h-full w-full border-0"
        />
      ) : null}
    </div>
  )
}
