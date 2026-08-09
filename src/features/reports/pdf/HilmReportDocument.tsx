import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from '@react-pdf/renderer'
import type { ChartDatum, ReportSnapshot } from '@/features/reports/types'

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
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

function stylesFor(accent: string) {
  return StyleSheet.create({
    page: {
      fontFamily: 'Helvetica',
      fontSize: 10,
      color: '#1e293b',
      paddingTop: 56,
      paddingBottom: 56,
      paddingHorizontal: 48,
      backgroundColor: '#ffffff',
    },
    coverPage: {
      fontFamily: 'Helvetica',
      paddingTop: 72,
      paddingBottom: 56,
      paddingHorizontal: 56,
      backgroundColor: '#0f172a',
      color: '#f8fafc',
    },
    brand: {
      fontSize: 28,
      fontFamily: 'Helvetica-Bold',
      letterSpacing: 4,
      color: '#ffffff',
    },
    org: {
      marginTop: 10,
      fontSize: 14,
      color: '#94a3b8',
    },
    coverTitle: {
      marginTop: 72,
      fontSize: 24,
      fontFamily: 'Helvetica-Bold',
      lineHeight: 1.3,
      color: '#ffffff',
    },
    coverMeta: {
      marginTop: 28,
      fontSize: 11,
      color: '#cbd5e1',
      lineHeight: 1.6,
    },
    coverAccentBar: {
      marginTop: 40,
      height: 4,
      width: 96,
      backgroundColor: accent,
    },
    header: {
      position: 'absolute',
      top: 22,
      left: 48,
      right: 48,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: '#e2e8f0',
      paddingBottom: 8,
    },
    headerText: {
      fontSize: 8,
      color: '#64748b',
    },
    footer: {
      position: 'absolute',
      bottom: 24,
      left: 48,
      right: 48,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: '#e2e8f0',
      paddingTop: 8,
    },
    footerText: {
      fontSize: 8,
      color: '#94a3b8',
    },
    h1: {
      fontSize: 16,
      fontFamily: 'Helvetica-Bold',
      marginBottom: 10,
      color: '#0f172a',
    },
    h2: {
      fontSize: 12,
      fontFamily: 'Helvetica-Bold',
      marginTop: 16,
      marginBottom: 8,
      color: '#0f172a',
    },
    body: {
      fontSize: 10,
      lineHeight: 1.55,
      color: '#334155',
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
      borderColor: '#e2e8f0',
      borderRadius: 6,
      padding: 10,
      marginBottom: 8,
      backgroundColor: '#f8fafc',
    },
    metricLabel: {
      fontSize: 8,
      color: '#64748b',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    metricValue: {
      fontSize: 16,
      fontFamily: 'Helvetica-Bold',
      color: accent,
    },
    metricHint: {
      marginTop: 3,
      fontSize: 7,
      color: '#94a3b8',
    },
    bullet: {
      fontSize: 10,
      lineHeight: 1.5,
      color: '#334155',
      marginBottom: 4,
      paddingLeft: 4,
    },
    table: {
      marginTop: 6,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: '#e2e8f0',
    },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: '#f1f5f9',
      borderBottomWidth: 1,
      borderBottomColor: '#e2e8f0',
      paddingVertical: 6,
      paddingHorizontal: 6,
    },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: '#f1f5f9',
      paddingVertical: 5,
      paddingHorizontal: 6,
    },
    th: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      color: '#475569',
    },
    td: {
      fontSize: 8,
      color: '#334155',
    },
    chartBlock: {
      marginBottom: 16,
      padding: 10,
      borderWidth: 1,
      borderColor: '#e2e8f0',
    },
    chartTitle: {
      fontSize: 10,
      fontFamily: 'Helvetica-Bold',
      marginBottom: 8,
      color: '#0f172a',
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 5,
    },
    barLabel: {
      width: 90,
      fontSize: 8,
      color: '#64748b',
    },
    barTrack: {
      flexGrow: 1,
      height: 10,
      backgroundColor: '#e2e8f0',
    },
    barValue: {
      width: 36,
      textAlign: 'right',
      fontSize: 8,
      color: '#475569',
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
      backgroundColor: '#f8fafc',
      borderWidth: 1,
      borderColor: '#e2e8f0',
    },
    metaLine: {
      fontSize: 9,
      color: '#475569',
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
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        Generated by {snapshot.generatedBy} · {formatWhen(snapshot.generatedAt)}
      </Text>
      <Text
        style={styles.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
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
          <View style={[styles.pieSwatch, { backgroundColor: row.color ?? '#64748b' }]} />
          <Text style={{ fontSize: 8, color: '#334155' }}>
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
  const accent = snapshot.branding.accent || '#2563eb'
  const styles = stylesFor(accent)
  const sections = new Set(snapshot.sections)

  return (
    <Document
      title={snapshot.title}
      author={snapshot.generatedBy}
      subject={`${snapshot.branding.productName} Report`}
      creator="Hilm Report Engine"
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
            Reporting period{'\n'}
            {snapshot.periodStart} → {snapshot.periodEnd}
            {'\n\n'}
            Generated on{'\n'}
            {formatWhen(snapshot.generatedAt)}
            {'\n\n'}
            Generated by{'\n'}
            {snapshot.generatedBy}
            {snapshot.os === 'personal' ? '\n\nPersonal OS' : ''}
          </Text>
        </Page>
      ) : null}

      <Page size="A4" style={styles.page}>
        <Header snapshot={snapshot} styles={styles} />
        <Footer snapshot={snapshot} styles={styles} />

        <View style={styles.metaBox}>
          <Text style={styles.metaLine}>Report: {snapshot.title}</Text>
          <Text style={styles.metaLine}>Generated by: {snapshot.generatedBy}</Text>
          <Text style={styles.metaLine}>Generated on: {formatWhen(snapshot.generatedAt)}</Text>
          <Text style={styles.metaLine}>
            Reporting period: {snapshot.periodStart} → {snapshot.periodEnd}
          </Text>
          {snapshot.workspaceName ? (
            <Text style={styles.metaLine}>Workspace / Organization: {snapshot.workspaceName}</Text>
          ) : (
            <Text style={styles.metaLine}>Scope: Personal OS</Text>
          )}
        </View>

        {sections.has('executive_summary') ? (
          <View>
            <Text style={styles.h1}>Executive Summary</Text>
            <Text style={styles.body}>{snapshot.executiveSummary}</Text>
          </View>
        ) : null}

        {sections.has('key_metrics') && snapshot.metrics.length ? (
          <View>
            <Text style={styles.h1}>Key Metrics</Text>
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
            <Text style={styles.h1}>Detailed Analysis</Text>
            <Text style={styles.body}>
              This section summarizes distribution and delivery pressure across the selected scope
              for the reporting period. Metrics above are computed only from data you can access in{' '}
              {snapshot.os === 'workspace' ? 'Workspace OS' : 'Personal OS'}.
            </Text>
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
                  <Text style={styles.body}>No rows in this section for the selected filters.</Text>
                )}
              </View>
            ))
          : null}

        {sections.has('ai_insights') && snapshot.insights.length ? (
          <View>
            <Text style={styles.h1}>AI Insights</Text>
            {snapshot.insights.map((line, index) => (
              <Text key={index} style={styles.bullet}>
                • {line}
              </Text>
            ))}
          </View>
        ) : null}

        {sections.has('recommendations') && snapshot.recommendations.length ? (
          <View>
            <Text style={styles.h1}>Recommendations</Text>
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
