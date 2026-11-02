import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import { pdf } from '@react-pdf/renderer'
import { HilmReportDocument } from '@/shared/reports/pdf/HilmReportDocument'
import type { ReportSnapshot } from '@/shared/reports/types'
import { cn } from '@/lib/utils'

/**
 * Desktop browsers show the PDF in their own viewer (iframe). Phones have no inline PDF viewer
 * (Android Chrome shows "This content is blocked"), so there the pages are drawn as images with
 * PDF.js, loaded only when needed.
 */
function hasInlinePdfViewer() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return navigator.pdfViewerEnabled === true && !coarse
}

async function renderPages(blob: Blob, width: number, isCancelled: () => boolean) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, useSystemFonts: true }).promise
  const images: string[] = []
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      if (isCancelled()) break
      const page = await doc.getPage(index)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (width / base.width) * ratio })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) continue
      await page.render({ canvasContext: context, viewport }).promise
      images.push(canvas.toDataURL('image/png'))
      page.cleanup()
    }
  } finally {
    void doc.destroy()
  }
  return images
}

export function ReportPdfPreview({
  snapshot,
  className,
}: {
  snapshot: ReportSnapshot
  className?: string
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [inline] = useState(hasInlinePdfViewer)
  const previewKey = [
    snapshot.generatedAt,
    snapshot.title,
    snapshot.charts.map((chart) => `${chart.kind}:${chart.title}:${chart.data.length}:${chart.series?.length ?? 0}`).join('|'),
    snapshot.metrics.map((metric) => `${metric.id}:${metric.value}`).join('|'),
  ].join('::')

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setLoading(true)
    setError(null)
    setUrl(null)
    setPages([])

    void (async () => {
      try {
        const blob = await pdf(<HilmReportDocument snapshot={snapshot} />).toBlob()
        if (cancelled) return
        if (inline) {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        } else {
          const width = containerRef.current?.clientWidth || 360
          const images = await renderPages(blob, width, () => cancelled)
          if (!cancelled) setPages(images)
        }
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
  }, [previewKey, inline])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full overflow-hidden rounded-xl border border-border-subtle bg-white',
        inline ? 'h-[70vh] min-h-[480px]' : 'min-h-[320px]',
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
      {pages.length ? (
        <div className="space-y-2 bg-zinc-200 p-2">
          {pages.map((src, index) => (
            <img
              key={index}
              src={src}
              alt={t('reports.previewPage', { defaultValue: 'Page {{page}}', page: index + 1 })}
              className="block w-full bg-white shadow-sm"
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
