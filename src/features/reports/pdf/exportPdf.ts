import { pdf } from '@react-pdf/renderer'
import { saveAs } from 'file-saver'
import { createElement } from 'react'
import { HilmReportDocument } from '@/features/reports/pdf/HilmReportDocument'
import type { ReportSnapshot } from '@/features/reports/types'

export async function renderReportBlob(snapshot: ReportSnapshot): Promise<Blob> {
  const doc = createElement(HilmReportDocument, { snapshot })
  return pdf(doc).toBlob()
}

export async function downloadReportPdf(snapshot: ReportSnapshot, filename?: string) {
  const blob = await renderReportBlob(snapshot)
  const safe = (filename ?? snapshot.title)
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
  saveAs(blob, `${safe || 'hilm-report'}.pdf`)
}
