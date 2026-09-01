import { pdf } from '@react-pdf/renderer'
import { saveAs } from 'file-saver'
import { HilmReportDocument } from '@/shared/reports/pdf/HilmReportDocument'
import type { ReportSnapshot } from '@/shared/reports/types'

export async function renderReportBlob(snapshot: ReportSnapshot): Promise<Blob> {
  return pdf(<HilmReportDocument snapshot={snapshot} />).toBlob()
}

export async function downloadReportPdf(snapshot: ReportSnapshot, filename?: string) {
  const blob = await renderReportBlob(snapshot)
  const safe = (filename ?? snapshot.title)
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
  saveAs(blob, `${safe || 'hilm-report'}.pdf`)
}
