import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
  Svg,
  Path,
  G,
  Line,
  Circle,
  Rect,
} from '@react-pdf/renderer'
import type { ChartDatum, ChartSeries, ReportChartKind, ReportSnapshot } from '@/shared/reports/types'
import i18n from '@/i18n'
import { localizedPdfCopy } from '@/shared/reports/i18n'

Font.register({
  family: 'NotoSansArabic',
  fonts: [
    {
      src: 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansArabic/NotoSansArabic-Regular.ttf',
      fontWeight: 'normal',
    },
    {
      src: 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansArabic/NotoSansArabic-Bold.ttf',
      fontWeight: 'bold',
    },
  ],
})

function formatWhen(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale.startsWith('ar') ? 'ar' : 'en', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Hilm monochrome print palette (matches app zinc theme, no blue). */
const HILM = {
  ink: '#111113',
  body: '#3f3f46',
  muted: '#71717a',
  mutedSoft: '#a1a1aa',
  border: '#d4d4d8',
  borderSubtle: '#e4e4e7',
  surface: '#f7f7f8',
  surface2: '#f1f1f3',
  paper: '#ffffff',
  cover: '#0a0a0b',
  coverFg: '#f4f4f5',
  coverMuted: '#a1a1aa',
  accent: '#18181b',
  accentOnCover: '#e4e4e7',
} as const

function stylesFor(accent: string, arabic: boolean) {
  const accentInk = accent && accent !== '#2563eb' ? accent : HILM.accent
  const font = arabic ? 'NotoSansArabic' : 'Helvetica'
  const fontBold = arabic ? 'NotoSansArabic' : 'Helvetica-Bold'
  return StyleSheet.create({
    page: {
      fontFamily: font,
      fontSize: 10,
      color: HILM.ink,
      paddingTop: 56,
      paddingBottom: 56,
      paddingHorizontal: 48,
      backgroundColor: HILM.paper,
    },
    coverPage: {
      fontFamily: font,
      paddingTop: 72,
      paddingBottom: 56,
      paddingHorizontal: 56,
      backgroundColor: HILM.cover,
      color: HILM.coverFg,
    },
    brand: {
      fontSize: 28,
      fontFamily: fontBold,
      fontWeight: arabic ? 700 : undefined,
      letterSpacing: arabic ? 0 : 4,
      color: HILM.coverFg,
    },
    org: {
      marginTop: 10,
      fontSize: 14,
      color: HILM.coverMuted,
    },
    coverTitle: {
      marginTop: 72,
      fontSize: 24,
      fontFamily: fontBold,
      fontWeight: arabic ? 700 : undefined,
      lineHeight: 1.3,
      color: HILM.coverFg,
    },
    coverMeta: {
      marginTop: 28,
      fontSize: 11,
      color: HILM.coverMuted,
      lineHeight: 1.6,
    },
    coverAccentBar: {
      marginTop: 40,
      height: 4,
      width: 96,
      backgroundColor: HILM.accentOnCover,
    },
    header: {
      position: 'absolute',
      top: 22,
      left: 48,
      right: 48,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: HILM.borderSubtle,
      paddingBottom: 8,
    },
    headerText: {
      fontSize: 8,
      color: HILM.muted,
    },
    footer: {
      position: 'absolute',
      bottom: 24,
      left: 48,
      right: 48,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: HILM.borderSubtle,
      paddingTop: 8,
    },
    footerText: {
      fontSize: 8,
      color: HILM.mutedSoft,
    },
    h1: {
      fontSize: 16,
      fontFamily: fontBold,
      marginBottom: 10,
      color: HILM.ink,
    },
    h2: {
      fontSize: 12,
      fontFamily: fontBold,
      marginTop: 16,
      marginBottom: 8,
      color: HILM.ink,
    },
    body: {
      fontSize: 10,
      lineHeight: 1.55,
      color: HILM.body,
      marginBottom: 8,
    },
    metricsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginBottom: 8,
    },
    metricCard: {
      width: '31%',
      marginRight: '2%',
      borderWidth: 1,
      borderColor: HILM.border,
      borderRadius: 6,
      padding: 10,
      marginBottom: 8,
      backgroundColor: HILM.surface,
    },
    metricLabel: {
      fontSize: 8,
      color: HILM.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    metricValue: {
      fontSize: 16,
      fontFamily: fontBold,
      color: accentInk,
    },
    metricHint: {
      marginTop: 3,
      fontSize: 7,
      color: HILM.mutedSoft,
    },
    bullet: {
      fontSize: 10,
      lineHeight: 1.5,
      color: HILM.body,
      marginBottom: 4,
      paddingLeft: 4,
    },
    table: {
      marginTop: 6,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: HILM.border,
    },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: HILM.surface2,
      borderBottomWidth: 1,
      borderBottomColor: HILM.border,
      paddingVertical: 6,
      paddingHorizontal: 6,
    },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: HILM.borderSubtle,
      paddingVertical: 5,
      paddingHorizontal: 6,
    },
    th: {
      fontSize: 8,
      fontFamily: fontBold,
      color: HILM.body,
    },
    td: {
      fontSize: 8,
      color: HILM.body,
    },
    chartBlock: {
      marginBottom: 16,
      padding: 10,
      borderWidth: 1,
      borderColor: HILM.border,
    },
    chartTitle: {
      fontSize: 10,
      fontFamily: fontBold,
      marginBottom: 8,
      color: HILM.ink,
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 5,
    },
    barLabel: {
      width: 90,
      fontSize: 8,
      color: HILM.muted,
    },
    barTrack: {
      flexGrow: 1,
      height: 10,
      backgroundColor: HILM.surface2,
    },
    barValue: {
      width: 36,
      textAlign: 'right',
      fontSize: 8,
      color: HILM.body,
      marginLeft: 6,
    },
    pieRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    pieSwatch: {
      width: 8,
      height: 8,
      marginRight: 6,
    },
    metaBox: {
      marginTop: 4,
      marginBottom: 16,
      padding: 12,
      backgroundColor: HILM.surface,
      borderWidth: 1,
      borderColor: HILM.border,
    },
    metaLine: {
      fontSize: 9,
      color: HILM.body,
      marginBottom: 3,
    },
    logo: {
      width: 48,
      height: 48,
      marginBottom: 12,
    },
  })
}

function Header({ snapshot, styles }: { snapshot: ReportSnapshot; styles: ReturnType<typeof stylesFor> }) {
  return (
    <View style={styles.header} fixed>
      <Text style={styles.headerText}>
        {snapshot.branding.productName}
        {snapshot.workspaceName ? ` · ${snapshot.workspaceName}` : ''}
      </Text>
      <Text style={styles.headerText}>{snapshot.title}</Text>
    </View>
  )
}

function Footer({ snapshot, styles }: { snapshot: ReportSnapshot; styles: ReturnType<typeof stylesFor> }) {
  const locale = snapshot.config?.locale === 'ar' ? 'ar' : 'en'
  const t = i18n.getFixedT(locale)
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        {t('reports.pdf.generatedBy', { name: snapshot.generatedBy })} ·{' '}
        {formatWhen(snapshot.generatedAt, locale)}
      </Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) =>
          locale === 'ar'
            ? `صفحة ${pageNumber} من ${totalPages}`
            : `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  )
}

const PIE_FALLBACK = ['#18181b', '#52525b', '#a1a1aa', '#3f3f46', '#71717a', '#d4d4d8']

function BarChart({
  data,
  styles,
  accent,
}: {
  data: ChartDatum[]
  styles: ReturnType<typeof stylesFor>
  accent: string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <View>
      {data.slice(0, 10).map((row) => (
        <View key={row.label} style={styles.barRow} wrap={false}>
          <Text style={styles.barLabel}>{row.label}</Text>
          <View style={styles.barTrack}>
            <View
              style={{
                height: 10,
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                backgroundColor: row.color ?? accent,
              }}
            />
          </View>
          <Text style={styles.barValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  )
}

function ColumnChart({
  data,
  accent,
}: {
  data: ChartDatum[]
  accent: string
}) {
  const rows = data.slice(0, 10)
  const max = Math.max(...rows.map((d) => d.value), 1)
  const width = 460
  const height = 140
  const padX = 28
  const padTop = 12
  const padBottom = 28
  const chartH = height - padTop - padBottom
  const gap = 8
  const barW = Math.max(10, (width - padX * 2 - gap * Math.max(rows.length - 1, 0)) / Math.max(rows.length, 1))

  return (
    <View>
      <Svg width={width} height={height}>
        <Line
          x1={padX}
          y1={padTop + chartH}
          x2={width - padX}
          y2={padTop + chartH}
          stroke="#e4e4e7"
          strokeWidth={1}
        />
        {rows.map((row, index) => {
          const h = Math.max(2, (row.value / max) * chartH)
          const x = padX + index * (barW + gap)
          const y = padTop + chartH - h
          return (
            <Rect
              key={`${row.label}-${index}`}
              x={x}
              y={y}
              width={barW}
              height={h}
              fill={row.color ?? accent}
            />
          )
        })}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 }}>
        {rows.map((row) => (
          <Text
            key={row.label}
            style={{ fontSize: 7, color: HILM.muted, width: `${100 / Math.max(rows.length, 1)}%`, textAlign: 'center' }}
          >
            {row.label.length > 10 ? `${row.label.slice(0, 9)}…` : row.label}
            {'\n'}
            {row.value}
          </Text>
        ))}
      </View>
    </View>
  )
}

function LineChart({
  data,
  series,
  accent,
}: {
  data: ChartDatum[]
  series?: ChartSeries[]
  accent: string
}) {
  const lines =
    series && series.length
      ? series
      : [{ name: 'Series', color: accent, data }]
  const allPoints = lines.flatMap((line) => line.data)
  const labels = lines[0]?.data.map((point) => point.label) ?? data.map((point) => point.label)
  const max = Math.max(...allPoints.map((point) => point.value), 1)
  const width = 460
  const height = 150
  const padX = 24
  const padTop = 16
  const padBottom = 28
  const chartW = width - padX * 2
  const chartH = height - padTop - padBottom
  const n = Math.max(labels.length, 1)

  function pointAt(index: number, value: number) {
    const x = padX + (n === 1 ? chartW / 2 : (index / (n - 1)) * chartW)
    const y = padTop + chartH - (value / max) * chartH
    return { x, y }
  }

  return (
    <View>
      <Svg width={width} height={height}>
        <Line
          x1={padX}
          y1={padTop + chartH}
          x2={width - padX}
          y2={padTop + chartH}
          stroke="#e4e4e7"
          strokeWidth={1}
        />
        {lines.map((line, lineIndex) => {
          const color = line.color ?? PIE_FALLBACK[lineIndex % PIE_FALLBACK.length]
          const pts = line.data.map((point, index) => pointAt(index, point.value))
          const d = pts
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
            .join(' ')
          return (
            <G key={line.name}>
              {pts.length > 1 ? <Path d={d} stroke={color} strokeWidth={2} fill="none" /> : null}
              {pts.map((point, index) => (
                <Circle key={`${line.name}-${index}`} cx={point.x} cy={point.y} r={2.5} fill={color} />
              ))}
            </G>
          )
        })}
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {lines.map((line, index) => (
          <View key={line.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: line.color ?? PIE_FALLBACK[index % PIE_FALLBACK.length],
              }}
            />
            <Text style={{ fontSize: 8, color: HILM.body }}>{line.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        {labels.filter((_, index) => index === 0 || index === labels.length - 1 || index % Math.ceil(labels.length / 4) === 0).map((label) => (
          <Text key={label} style={{ fontSize: 7, color: HILM.muted }}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  )
}

function ComparisonChart({
  data,
  series,
  accent,
}: {
  data: ChartDatum[]
  series?: ChartSeries[]
  accent: string
}) {
  const groups =
    series && series.length >= 2
      ? series.slice(0, 3)
      : [
          { name: 'A', color: '#a1a1aa', data },
          {
            name: 'B',
            color: accent,
            data: data.map((row) => ({ ...row, value: Math.max(0, row.value - 1) })),
          },
        ]
  const labels = groups[0]?.data.map((row) => row.label) ?? []
  const max = Math.max(...groups.flatMap((group) => group.data.map((row) => row.value)), 1)
  const width = 460
  const height = 160
  const padX = 20
  const padTop = 12
  const padBottom = 36
  const chartH = height - padTop - padBottom
  const groupCount = Math.max(labels.length, 1)
  const groupW = (width - padX * 2) / groupCount
  const barGap = 2
  const barW = Math.max(4, (groupW - 8 - barGap * (groups.length - 1)) / groups.length)

  return (
    <View>
      <Svg width={width} height={height}>
        <Line
          x1={padX}
          y1={padTop + chartH}
          x2={width - padX}
          y2={padTop + chartH}
          stroke="#e4e4e7"
          strokeWidth={1}
        />
        {labels.map((label, groupIndex) => {
          const groupX = padX + groupIndex * groupW + 4
          return groups.map((group, seriesIndex) => {
            const value = group.data[groupIndex]?.value ?? 0
            const h = Math.max(2, (value / max) * chartH)
            const x = groupX + seriesIndex * (barW + barGap)
            const y = padTop + chartH - h
            return (
              <Rect
                key={`${label}-${group.name}`}
                x={x}
                y={y}
                width={barW}
                height={h}
                fill={group.color ?? PIE_FALLBACK[seriesIndex % PIE_FALLBACK.length]}
              />
            )
          })
        })}
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        {groups.map((group, index) => (
          <View key={group.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: group.color ?? PIE_FALLBACK[index % PIE_FALLBACK.length],
              }}
            />
            <Text style={{ fontSize: 8, color: HILM.body }}>{group.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {labels.map((label) => (
          <Text
            key={label}
            style={{
              fontSize: 6.5,
              color: HILM.muted,
              width: `${100 / Math.max(labels.length, 1)}%`,
              textAlign: 'center',
            }}
          >
            {label.length > 12 ? `${label.slice(0, 11)}…` : label}
          </Text>
        ))}
      </View>
    </View>
  )
}

function renderChartVisual({
  kind,
  data,
  series,
  styles,
  accent,
}: {
  kind: ReportChartKind
  data: ChartDatum[]
  series?: ChartSeries[]
  styles: ReturnType<typeof stylesFor>
  accent: string
}) {
  if (kind === 'pie') return <PieChart data={data} styles={styles} />
  if (kind === 'line') return <LineChart data={data} series={series} accent={accent} />
  if (kind === 'column') return <ColumnChart data={data} accent={accent} />
  if (kind === 'comparison') {
    return <ComparisonChart data={data} series={series} accent={accent} />
  }
  return <BarChart data={data} styles={styles} accent={accent} />
}

function PieLegend({ data, styles }: { data: ChartDatum[]; styles: ReturnType<typeof stylesFor> }) {
  const total = data.reduce((sum, row) => sum + row.value, 0) || 1
  return (
    <View>
      {data.map((row) => (
        <View key={row.label} style={styles.pieRow} wrap={false}>
          <View style={[styles.pieSwatch, { backgroundColor: row.color ?? HILM.muted }]} />
          <Text style={{ fontSize: 8, color: HILM.body }}>
            {row.label}: {row.value} ({Math.round((row.value / total) * 100)}%)
          </Text>
        </View>
      ))}
    </View>
  )
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  }
}

function slicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
}

function PieChart({
  data,
  styles,
}: {
  data: ChartDatum[]
  styles: ReturnType<typeof stylesFor>
}) {
  const total = data.reduce((sum, row) => sum + Math.max(0, row.value), 0) || 1
  const size = 120
  const cx = size / 2
  const cy = size / 2
  const r = 52
  let angle = -Math.PI / 2
  const slices = data
    .filter((row) => row.value > 0)
    .map((row, index) => {
      const sweep = (row.value / total) * Math.PI * 2
      const start = angle
      const end = angle + sweep
      angle = end
      // Full circle edge case — draw a ring-ish circle via two halves
      const path =
        sweep >= Math.PI * 2 - 0.001
          ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`
          : slicePath(cx, cy, r, start, end)
      return {
        key: `${row.label}-${index}`,
        path,
        color: row.color ?? PIE_FALLBACK[index % PIE_FALLBACK.length],
      }
    })

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <Svg width={size} height={size}>
        <G>
          {slices.map((slice) => (
            <Path key={slice.key} d={slice.path} fill={slice.color} />
          ))}
        </G>
      </Svg>
      <View style={{ flexGrow: 1 }}>
        <PieLegend data={data} styles={styles} />
      </View>
    </View>
  )
}


function safeLogoUrl(url?: string | null) {
  if (!url?.trim()) return null
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('data:image/')) return trimmed
  return null
}

function DataTable({
  headers,
  rows,
  styles,
}: {
  headers: string[]
  rows: string[][]
  styles: ReturnType<typeof stylesFor>
}) {
  const width = `${Math.floor(100 / Math.max(headers.length, 1))}%`
  return (
    <View style={styles.table}>
      <View style={styles.tableHeader} wrap={false}>
        {headers.map((header) => (
          <Text key={header} style={[styles.th, { width }]}>
            {header}
          </Text>
        ))}
      </View>
      {rows.map((row, index) => (
        <View key={index} style={styles.tableRow} wrap={false}>
          {row.map((cell, cellIndex) => (
            <Text key={cellIndex} style={[styles.td, { width }]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

export function HilmReportDocument({ snapshot }: { snapshot: ReportSnapshot }) {
  const locale = snapshot.config?.locale === 'ar' ? 'ar' : 'en'
  const arabic = locale === 'ar'
  const t = i18n.getFixedT(locale)
  const copy = localizedPdfCopy(t)
  const accent = snapshot.branding.accent || HILM.accent
  const styles = stylesFor(accent, arabic)
  const sections = new Set(snapshot.sections)
  const logoUrl = safeLogoUrl(snapshot.branding.logoUrl)

  return (
    <Document
      title={snapshot.title}
      author={snapshot.generatedBy}
      subject={`${snapshot.branding.productName} Report`}
      creator="Hilm Report Engine"
      language={locale}
    >
      {sections.has('cover') ? (
        <Page size="A4" style={styles.coverPage}>
          {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}
          <Text style={styles.brand}>{snapshot.branding.productName}</Text>
          {snapshot.workspaceName ? <Text style={styles.org}>{snapshot.workspaceName}</Text> : null}
          <View style={styles.coverAccentBar} />
          <Text style={styles.coverTitle}>{snapshot.title}</Text>
          <Text style={styles.coverMeta}>
            {t('reports.dateRange')}
            {'\n'}
            {snapshot.periodStart} → {snapshot.periodEnd}
            {'\n\n'}
            {copy.generatedAt(formatWhen(snapshot.generatedAt, locale))}
            {'\n\n'}
            {t('reports.pdf.generatedBy', { name: snapshot.generatedBy })}
            {snapshot.os === 'personal' ? `\n\n${copy.personalOs}` : ''}
          </Text>
        </Page>
      ) : null}

      <Page size="A4" style={styles.page}>
        <Header snapshot={snapshot} styles={styles} />
        <Footer snapshot={snapshot} styles={styles} />

        <View style={styles.metaBox}>
          <Text style={styles.metaLine}>
            {t('reports.pdf.reportMeta', { title: snapshot.title })}
          </Text>
          <Text style={styles.metaLine}>
            {t('reports.pdf.generatedBy', { name: snapshot.generatedBy })}
          </Text>
          <Text style={styles.metaLine}>
            {t('reports.pdf.generatedOn', { when: formatWhen(snapshot.generatedAt, locale) })}
          </Text>
          <Text style={styles.metaLine}>
            {t('reports.pdf.reportingPeriod', {
              start: snapshot.periodStart,
              end: snapshot.periodEnd,
            })}
          </Text>
          {snapshot.workspaceName ? (
            <Text style={styles.metaLine}>
              {t('reports.pdf.workspaceOrg', { name: snapshot.workspaceName })}
            </Text>
          ) : (
            <Text style={styles.metaLine}>{t('reports.pdf.scopePersonal')}</Text>
          )}
        </View>

        {sections.has('executive_summary') ? (
          <View>
            <Text style={styles.h1}>{copy.executiveSummary}</Text>
            <Text style={styles.body}>{snapshot.executiveSummary}</Text>
          </View>
        ) : null}

        {sections.has('key_metrics') && snapshot.metrics.length ? (
          <View>
            <Text style={styles.h1}>{copy.keyMetrics}</Text>
            <View style={styles.metricsGrid}>
              {snapshot.metrics.map((metric) => (
                <View key={metric.id} style={styles.metricCard} wrap={false}>
                  <Text style={styles.metricLabel}>{metric.label}</Text>
                  <Text style={styles.metricValue}>{String(metric.value)}</Text>
                  {metric.hint ? <Text style={styles.metricHint}>{metric.hint}</Text> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {sections.has('charts') && snapshot.charts.length
          ? snapshot.charts.map((chart) => (
              <View key={chart.title} style={styles.chartBlock} wrap={false}>
                <Text style={styles.chartTitle}>{chart.title}</Text>
                {renderChartVisual({
                  kind: chart.kind,
                  data: chart.data,
                  series: chart.series,
                  styles,
                  accent,
                })}
              </View>
            ))
          : null}

        {sections.has('detailed_analysis') ? (
          <View>
            <Text style={styles.h1}>{copy.detailedAnalysis}</Text>
            <Text style={styles.body}>{snapshot.executiveSummary}</Text>
          </View>
        ) : null}

        {(sections.has('projects') ||
          sections.has('tasks') ||
          sections.has('teams') ||
          sections.has('appendix')) &&
        snapshot.tables.length
          ? snapshot.tables.map((table) => (
              <View key={table.title}>
                <Text style={styles.h2}>{table.title}</Text>
                {table.rows.length ? (
                  <DataTable headers={table.headers} rows={table.rows} styles={styles} />
                ) : (
                  <Text style={styles.body}>{t('common.noResults')}</Text>
                )}
              </View>
            ))
          : null}

        {sections.has('ai_insights') && snapshot.insights.length ? (
          <View>
            <Text style={styles.h1}>{copy.aiInsights}</Text>
            {snapshot.insights.map((line, index) => (
              <Text key={index} style={styles.bullet}>
                • {line}
              </Text>
            ))}
          </View>
        ) : null}

        {sections.has('recommendations') && snapshot.recommendations.length ? (
          <View>
            <Text style={styles.h1}>{copy.recommendations}</Text>
            {snapshot.recommendations.map((line, index) => (
              <Text key={index} style={styles.bullet}>
                • {line}
              </Text>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  )
}
