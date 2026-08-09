import { PDFViewer } from '@react-pdf/renderer'
import { HilmReportDocument } from '@/features/reports/pdf/HilmReportDocument'
import type { ReportSnapshot } from '@/features/reports/types'

export function ReportPdfPreview({
  snapshot,
  className,
}: {
  snapshot: ReportSnapshot
  className?: string
}) {
  return (
    <div className={className ?? 'h-[70vh] min-h-[480px] w-full overflow-hidden rounded-xl border border-border-subtle bg-white'}>
      <PDFViewer width="100%" height="100%" showToolbar={false} style={{ border: 'none' }}>
        <HilmReportDocument snapshot={snapshot} />
      </PDFViewer>
    </div>
  )
}
