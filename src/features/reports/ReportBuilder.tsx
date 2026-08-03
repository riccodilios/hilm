import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileText, Save } from 'lucide-react'
import { jsPDF } from 'jspdf'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { saveAs } from 'file-saver'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type ReportType = 'executive' | 'project' | 'sprint' | 'progress' | 'performance'

export type ReportStatRow = {
  label: string
  value: number
}

export type ReportStats = {
  title: string
  subtitle?: string
  projectCount: number
  openTaskCount: number
  doneTaskCount: number
  overdueCount?: number
  byStatus?: ReportStatRow[]
  byPriority?: ReportStatRow[]
}

const REPORT_TYPES: ReportType[] = [
  'executive',
  'project',
  'sprint',
  'progress',
  'performance',
]

function barChartSvg(rows: ReportStatRow[], maxWidth = 320, barHeight = 18): string {
  if (!rows.length) return ''
  const max = Math.max(...rows.map((r) => r.value), 1)
  const gap = 6
  const labelWidth = 90
  const chartWidth = maxWidth - labelWidth - 40
  const height = rows.length * (barHeight + gap) + 8
  const bars = rows
    .map((row, i) => {
      const y = 8 + i * (barHeight + gap)
      const w = Math.round((row.value / max) * chartWidth)
      return `
        <text x="0" y="${y + barHeight - 4}" fill="#94a3b8" font-size="11">${escapeXml(row.label)}</text>
        <rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" rx="3" fill="#64748b"/>
        <text x="${labelWidth + w + 6}" y="${y + barHeight - 4}" fill="#cbd5e1" font-size="11">${row.value}</text>
      `
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth}" height="${height}" viewBox="0 0 ${maxWidth} ${height}">${bars}</svg>`
}

function escapeXml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildReportHtml(type: ReportType, stats: ReportStats): string {
  const statusChart = stats.byStatus?.length ? barChartSvg(stats.byStatus) : ''
  const priorityChart = stats.byPriority?.length ? barChartSvg(stats.byPriority) : ''
  return `
    <article style="font-family:system-ui,sans-serif;color:#e2e8f0;background:#0f1115;padding:24px;max-width:720px">
      <header style="border-bottom:1px solid #27272a;padding-bottom:16px;margin-bottom:20px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#71717a">${type} report</p>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:500">${escapeXml(stats.title)}</h1>
        ${stats.subtitle ? `<p style="margin:6px 0 0;color:#a1a1aa;font-size:13px">${escapeXml(stats.subtitle)}</p>` : ''}
      </header>
      <section style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:24px">
        <div style="border:1px solid #27272a;border-radius:12px;padding:12px"><p style="margin:0;font-size:11px;color:#71717a">Projects</p><p style="margin:4px 0 0;font-size:20px">${stats.projectCount}</p></div>
        <div style="border:1px solid #27272a;border-radius:12px;padding:12px"><p style="margin:0;font-size:11px;color:#71717a">Open tasks</p><p style="margin:4px 0 0;font-size:20px">${stats.openTaskCount}</p></div>
        <div style="border:1px solid #27272a;border-radius:12px;padding:12px"><p style="margin:0;font-size:11px;color:#71717a">Done</p><p style="margin:4px 0 0;font-size:20px">${stats.doneTaskCount}</p></div>
        <div style="border:1px solid #27272a;border-radius:12px;padding:12px"><p style="margin:0;font-size:11px;color:#71717a">Overdue</p><p style="margin:4px 0 0;font-size:20px">${stats.overdueCount ?? 0}</p></div>
      </section>
      ${statusChart ? `<section style="margin-bottom:20px"><h2 style="font-size:14px;font-weight:500;margin:0 0 10px">By status</h2>${statusChart}</section>` : ''}
      ${priorityChart ? `<section><h2 style="font-size:14px;font-weight:500;margin:0 0 10px">By priority</h2>${priorityChart}</section>` : ''}
    </article>
  `.trim()
}

async function exportPdf(html: string, filename: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const container = document.createElement('div')
  container.innerHTML = html
  container.style.width = '520px'
  document.body.appendChild(container)
  await doc.html(container, { x: 24, y: 24, width: 520, windowWidth: 720 })
  document.body.removeChild(container)
  doc.save(filename)
}

async function exportDocx(stats: ReportStats, type: ReportType, filename: string) {
  const rows: ReportStatRow[] = [
    { label: 'Projects', value: stats.projectCount },
    { label: 'Open tasks', value: stats.openTaskCount },
    { label: 'Done', value: stats.doneTaskCount },
    { label: 'Overdue', value: stats.overdueCount ?? 0 },
  ]
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: `${type} report`,
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({ text: stats.title }),
          ...(stats.subtitle ? [new Paragraph({ text: stats.subtitle })] : []),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows.map(
              (row) =>
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph(row.label)] }),
                    new TableCell({ children: [new Paragraph(String(row.value))] }),
                  ],
                }),
            ),
          }),
          ...(stats.byStatus?.length
            ? [
                new Paragraph({ text: '' }),
                new Paragraph({ children: [new TextRun({ text: 'By status', bold: true })] }),
                ...stats.byStatus.map(
                  (row) => new Paragraph({ text: `${row.label}: ${row.value}` }),
                ),
              ]
            : []),
        ],
      },
    ],
  })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, filename)
}

export function ReportBuilder({
  mode,
  stats,
  onSave,
  saving,
}: {
  mode: 'personal' | 'workspace'
  stats: ReportStats
  onSave: (input: { reportType: ReportType; title: string; contentHtml: string }) => Promise<unknown>
  saving?: boolean
}) {
  const { t } = useTranslation()
  const [reportType, setReportType] = useState<ReportType>('executive')
  const [title, setTitle] = useState(stats.title)

  const html = useMemo(() => buildReportHtml(reportType, { ...stats, title }), [reportType, stats, title])

  const prefix = mode === 'workspace' ? 'workspace' : 'reports'

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t(`${prefix}.builderTitle`, { defaultValue: 'Report builder' })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted">
              {t(`${prefix}.reportType`, { defaultValue: 'Report type' })}
            </label>
            <select
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
            >
              {REPORT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`${prefix}.types.${type}`, { defaultValue: type })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">
              {t(`${prefix}.reportTitle`, { defaultValue: 'Title' })}
            </label>
            <input
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={saving}
              onClick={() => onSave({ reportType, title: title.trim() || stats.title, contentHtml: html })}
            >
              <Save className="size-4" />
              {t(`${prefix}.saveReport`, { defaultValue: 'Save report' })}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => exportPdf(html, `${reportType}-report.pdf`)}
            >
              <Download className="size-4" />
              PDF
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => exportDocx({ ...stats, title }, reportType, `${reportType}-report.docx`)}
            >
              <FileText className="size-4" />
              DOCX
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(`${prefix}.preview`, { defaultValue: 'Preview' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="overflow-auto rounded-xl border border-border-subtle"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
