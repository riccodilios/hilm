import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
} from '@react-pdf/renderer'
import type { ChartDatum, ReportSnapshot } from '@/features/reports/types'
import i18n from '@/i18n'
import { localizedPdfCopy } from '@/features/reports/i18n'

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
          {snapshot.branding.logoUrl ? (
            <Image src={snapshot.branding.logoUrl} style={styles.logo} />
          ) : null}
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
                {chart.kind === 'pie' ? (
                  <PieLegend data={chart.data} styles={styles} />
                ) : (
                  <BarChart data={chart.data} styles={styles} accent={accent} />
                )}
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
