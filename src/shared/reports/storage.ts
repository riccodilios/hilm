import type { ReportSnapshot } from '@/shared/reports/types'
import type { Json } from '@/types/database'

export type StoredReportRow = {
  id: string
  report_type: string
  title: string
  content_html: string
  branding: Json
  created_at: string
  period_start?: string | null
  period_end?: string | null
  generated_by_name?: string | null
  status?: string | null
  config?: Json | null
  snapshot?: Json | null
  workspace_id?: string
  created_by?: string
  user_id?: string
}

export function rowToSnapshot(row: StoredReportRow): ReportSnapshot | null {
  const raw = row.snapshot
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { version?: number }).version === 1) {
    return raw as unknown as ReportSnapshot
  }
  const branding = row.branding
  if (branding && typeof branding === 'object' && !Array.isArray(branding)) {
    const nested = (branding as { snapshot?: unknown }).snapshot
    if (
      nested &&
      typeof nested === 'object' &&
      !Array.isArray(nested) &&
      (nested as { version?: number }).version === 1
    ) {
      return nested as ReportSnapshot
    }
  }
  return null
}
