import { StyleSheet, Text, View, Svg, Path, Circle } from '@react-pdf/renderer'
import type { TFunction } from 'i18next'
import type {
  RoadmapAnalysis,
  RoadmapReadiness,
  RoadmapReportData,
  RoadmapReportProject,
  RoadmapReportStep,
  RoadmapStage,
} from '@/shared/reports/roadmap'
import { roadmapAiReason } from '@/shared/reports/roadmap'
import { HILM, pdfFonts } from '@/shared/reports/pdf/theme'

type ProjectAnalysis = RoadmapAnalysis['projects'][number]
type StepNote = ProjectAnalysis['steps'][number]

/** Steps shown per lane on the diagram page; the step timeline lists every step. */
const LANE_LIMIT = 7
const STAGES: RoadmapStage[] = ['done', 'now', 'next', 'later', 'future']

function stylesFor(arabic: boolean) {
  const font = pdfFonts(arabic)
  return StyleSheet.create({
    h1: { fontSize: 15, fontFamily: font.bold, color: HILM.ink, marginBottom: 4 },
    h2: { fontSize: 12, fontFamily: font.bold, color: HILM.ink, marginTop: 14, marginBottom: 6 },
    h3: { fontSize: 10, fontFamily: font.bold, color: HILM.ink, marginTop: 10, marginBottom: 4 },
    sub: { fontSize: 9, color: HILM.muted, marginBottom: 12 },
    body: { fontSize: 9.5, lineHeight: 1.55, color: HILM.body, marginBottom: 6 },
    bullet: { fontSize: 9.5, lineHeight: 1.5, color: HILM.body, marginBottom: 3 },
    small: { fontSize: 7.5, color: HILM.muted },
    lanes: { flexDirection: 'row', alignItems: 'flex-start' },
    laneHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: 10,
      paddingVertical: 5,
      paddingHorizontal: 8,
      marginBottom: 8,
      borderWidth: 1,
    },
    laneLabel: { fontSize: 8, fontFamily: font.bold, letterSpacing: arabic ? 0 : 0.6 },
    nodeRow: { flexDirection: 'row' },
    gutter: { width: 18, alignItems: 'center' },
    circle: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    // Step numbers are Western digits: the Arabic font's tall line box would push them out of the circle.
    circleText: { fontSize: 7, fontFamily: 'Helvetica-Bold', lineHeight: 1 },
    connector: { width: 1.2, flexGrow: 1, backgroundColor: HILM.border, minHeight: 6 },
    card: {
      flexGrow: 1,
      flexBasis: 0,
      borderWidth: 1,
      borderColor: HILM.border,
      borderRadius: 5,
      paddingVertical: 5,
      paddingHorizontal: 6,
      marginBottom: 6,
      marginLeft: 4,
      backgroundColor: HILM.paper,
    },
    cardTitle: { fontSize: 8, fontFamily: font.bold, color: HILM.ink, lineHeight: 1.3 },
    cardMeta: { fontSize: 6.5, color: HILM.muted, marginTop: 2 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    chip: { borderRadius: 8, paddingVertical: 2, paddingHorizontal: 6, fontSize: 7, fontFamily: font.bold },
    metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
    metricCard: {
      width: '23%',
      marginRight: '2%',
      marginBottom: 6,
      padding: 7,
      borderWidth: 1,
      borderColor: HILM.border,
      borderRadius: 5,
      backgroundColor: HILM.surface,
    },
    metricLabel: { fontSize: 6.5, color: HILM.muted, textTransform: 'uppercase', marginBottom: 2 },
    metricValue: { fontSize: 12, fontFamily: font.bold, color: HILM.ink },
    timelineRow: { flexDirection: 'row' },
    timelineBody: { flexGrow: 1, flexBasis: 0, marginLeft: 6, paddingBottom: 10 },
    stepTitle: { fontSize: 10, fontFamily: font.bold, color: HILM.ink },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    barTrack: { width: 120, height: 6, borderRadius: 3, backgroundColor: HILM.surface2 },
    riskRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: HILM.borderSubtle, paddingVertical: 5 },
    riskHead: { flexDirection: 'row', backgroundColor: HILM.surface2, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: HILM.border },
    th: { fontSize: 7.5, fontFamily: font.bold, color: HILM.body, paddingHorizontal: 5 },
    td: { fontSize: 8, color: HILM.body, paddingHorizontal: 5, lineHeight: 1.4 },
    notice: { padding: 10, borderWidth: 1, borderColor: HILM.border, backgroundColor: HILM.surface, borderRadius: 5, marginTop: 6, marginBottom: 6 },
  })
}

type Styles = ReturnType<typeof stylesFor>

const clip = (value: string | null | undefined, max: number) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function formatDate(iso: string | null | undefined, arabic: boolean) {
  if (!iso) return ''
  try {
    return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(arabic ? 'ar' : 'en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso.slice(0, 10)
  }
}

/** Visual state of a step: the AI readiness when available, otherwise its stage. */
function nodeLook(step: RoadmapReportStep, note?: StepNote) {
  const readiness: RoadmapReadiness | null = step.stage === 'done' ? 'done' : (note?.readiness ?? null)
  if (readiness === 'done') return { fill: HILM.ink, border: HILM.ink, text: HILM.paper }
  if (readiness === 'blocked') return { fill: HILM.risk, border: HILM.risk, text: HILM.paper }
  if (readiness === 'in_progress' || (!readiness && step.stage === 'now')) return { fill: HILM.paper, border: HILM.ink, text: HILM.ink }
  if (readiness === 'ready') return { fill: HILM.paper, border: HILM.good, text: HILM.good }
  return { fill: HILM.paper, border: HILM.mutedSoft, text: HILM.muted }
}

function statusColor(status: ProjectAnalysis['status']) {
  if (status === 'on_track') return HILM.good
  if (status === 'off_track') return HILM.risk
  if (status === 'at_risk') return HILM.caution
  return HILM.muted
}

function severityColor(severity: 'high' | 'medium' | 'low') {
  return severity === 'high' ? HILM.risk : severity === 'medium' ? HILM.caution : HILM.muted
}

/** Numbered node. The number is absolutely positioned so it is always painted above the circle (Arabic pages otherwise paint the fill over it). */
function Node({ step, note, styles }: { step: RoadmapReportStep; note?: StepNote; styles: Styles }) {
  const look = nodeLook(step, note)
  const stroke = step.stage === 'now' ? 1.6 : 1.1
  return (
    <View style={{ width: 16, height: 16, position: 'relative' }}>
      <Svg width={16} height={16}>
        <Circle cx={8} cy={8} r={8 - stroke / 2} fill={look.fill} stroke={look.border} strokeWidth={stroke} />
      </Svg>
      <Text style={[styles.circleText, { color: look.text, position: 'absolute', top: 4.5, left: 0, width: 16, textAlign: 'center' }]}>
        {step.order}
      </Text>
    </View>
  )
}

function laneStyle(stage: RoadmapStage) {
  if (stage === 'done') return { backgroundColor: HILM.ink, borderColor: HILM.ink, color: HILM.paper }
  if (stage === 'now') return { backgroundColor: HILM.paper, borderColor: HILM.ink, color: HILM.ink }
  return { backgroundColor: HILM.surface, borderColor: HILM.border, color: HILM.body }
}

function Arrow() {
  return (
    <View style={{ width: 16, alignItems: 'center', paddingTop: 7 }}>
      <Svg width={12} height={10}>
        <Path d="M0 5 L9 5 M5 1 L10 5 L5 9" stroke={HILM.mutedSoft} strokeWidth={1.4} fill="none" />
      </Svg>
    </View>
  )
}

export function RoadmapDiagram({
  project,
  analysis,
  t,
  arabic,
  contentWidth,
}: {
  project: RoadmapReportProject
  analysis?: ProjectAnalysis
  t: TFunction
  arabic: boolean
  contentWidth: number
}) {
  const styles = stylesFor(arabic)
  const notes = new Map((analysis?.steps ?? []).map((note) => [note.stepId, note]))
  const lanes = STAGES.filter((stage) => stage === 'now' || project.steps.some((step) => step.stage === stage))
  const laneWidth = (contentWidth - (lanes.length - 1) * 16) / Math.max(lanes.length, 1)

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flexGrow: 1, flexBasis: 0 }}>
          <Text style={styles.h1}>
            {t('reports.roadmap.pdf.diagramTitle')} · {project.name}
          </Text>
          <Text style={styles.sub}>
            {t('reports.roadmap.pdf.diagramSub', {
              steps: project.stats.stepsTotal,
              done: project.stats.stepsByStage.done,
              completion: project.stats.taskCompletionPct,
              open: project.stats.tasksOpen,
            })}
          </Text>
        </View>
        {analysis ? (
          <Text style={[styles.chip, { color: HILM.paper, backgroundColor: statusColor(analysis.status) }]}>
            {t(`reports.roadmap.status.${analysis.status}`)}
          </Text>
        ) : null}
      </View>

      {project.steps.length ? (
        <View style={styles.lanes}>
          {lanes.map((stage, laneIndex) => {
            const steps = project.steps.filter((step) => step.stage === stage)
            const shown = steps.slice(0, LANE_LIMIT)
            const look = laneStyle(stage)
            return (
              <View key={stage} style={{ flexDirection: 'row' }}>
                {laneIndex > 0 ? <Arrow /> : null}
                <View style={{ width: laneWidth }}>
                  <View style={[styles.laneHeader, { backgroundColor: look.backgroundColor, borderColor: look.borderColor }]}>
                    <Text style={[styles.laneLabel, { color: look.color }]}>{t(`reports.roadmap.stage.${stage}`)}</Text>
                    <Text style={[styles.laneLabel, { color: look.color }]}>{steps.length}</Text>
                  </View>
                  {shown.length ? (
                    shown.map((step, index) => {
                      const note = notes.get(step.id)
                      const last = index === shown.length - 1
                      return (
                        <View key={step.id} style={styles.nodeRow} wrap={false}>
                          <View style={styles.gutter}>
                            <Node step={step} note={note} styles={styles} />
                            {last ? null : <View style={styles.connector} />}
                          </View>
                          <View style={styles.card}>
                            <Text style={styles.cardTitle}>{clip(step.title, 90)}</Text>
                            <Text style={styles.cardMeta}>
                              {step.stage === 'done'
                                ? t('reports.roadmap.pdf.completedOn', { date: formatDate(step.completedAt, arabic) })
                                : note
                                  ? `${t(`reports.roadmap.readiness.${note.readiness}`)} · ${t('reports.roadmap.pdf.relatedTasks', { count: note.relatedTasks })}`
                                  : step.endsAt
                                    ? t('reports.roadmap.pdf.until', { date: formatDate(step.endsAt, arabic) })
                                    : t(`reports.roadmap.stage.${step.stage}`)}
                            </Text>
                          </View>
                        </View>
                      )
                    })
                  ) : (
                    <Text style={[styles.small, { paddingHorizontal: 4 }]}>{t('reports.roadmap.pdf.emptyLane')}</Text>
                  )}
                  {steps.length > shown.length ? (
                    <Text style={[styles.small, { marginLeft: 22 }]}>
                      {t('reports.roadmap.pdf.more', { count: steps.length - shown.length })}
                    </Text>
                  ) : null}
                </View>
              </View>
            )
          })}
        </View>
      ) : (
        <View style={styles.notice}>
          <Text style={styles.body}>{t('reports.roadmap.pdf.noSteps')}</Text>
        </View>
      )}

      <View style={styles.legend}>
        {(['done', 'in_progress', 'ready', 'not_started', 'blocked'] as RoadmapReadiness[]).map((readiness) => {
          const look = nodeLook(
            { stage: readiness === 'done' ? 'done' : 'next' } as RoadmapReportStep,
            readiness === 'done' ? undefined : ({ readiness } as StepNote),
          )
          return (
            <View key={readiness} style={styles.legendItem}>
              <View style={[styles.circle, { width: 9, height: 9, backgroundColor: look.fill, borderWidth: 1, borderColor: look.border }]} />
              <Text style={styles.small}>{t(`reports.roadmap.readiness.${readiness}`)}</Text>
            </View>
          )
        })}
        {analysis ? null : <Text style={styles.small}>{t('reports.roadmap.pdf.legendNoAi')}</Text>}
      </View>
    </View>
  )
}

function ProjectMetrics({ project, t, styles }: { project: RoadmapReportProject; t: TFunction; styles: Styles }) {
  const s = project.stats
  const cards: Array<[string, string | number]> = [
    [t('reports.roadmap.metrics.steps'), s.stepsTotal],
    [t('reports.roadmap.metrics.done'), s.stepsByStage.done],
    [t('reports.roadmap.metrics.now'), s.stepsByStage.now],
    [t('reports.roadmap.metrics.upcoming'), s.stepsByStage.next + s.stepsByStage.later + s.stepsByStage.future],
    [t('reports.roadmap.metrics.completion'), `${s.taskCompletionPct}%`],
    [t('reports.roadmap.metrics.openTasks'), s.tasksOpen],
    [t('reports.roadmap.metrics.overdue'), s.tasksOverdue],
    [t('reports.roadmap.metrics.velocity'), s.completedLast14d],
    [t('reports.roadmap.metrics.dueSoon'), s.tasksDueSoon],
    [t('reports.roadmap.metrics.urgent'), s.urgentOpen],
    [t('reports.roadmap.metrics.oldestNow'), s.oldestNowDays == null ? '—' : t('reports.roadmap.metrics.days', { count: s.oldestNowDays })],
    ...(s.unassignedOpen == null ? [] : ([[t('reports.roadmap.metrics.unassigned'), s.unassignedOpen]] as Array<[string, number]>)),
  ]
  return (
    <View style={styles.metricsGrid}>
      {cards.map(([label, value]) => (
        <View key={label} style={styles.metricCard} wrap={false}>
          <Text style={styles.metricLabel}>{label}</Text>
          <Text style={styles.metricValue}>{String(value)}</Text>
        </View>
      ))}
    </View>
  )
}

export function RoadmapStepTimeline({
  project,
  analysis,
  t,
  arabic,
}: {
  project: RoadmapReportProject
  analysis?: ProjectAnalysis
  t: TFunction
  arabic: boolean
}) {
  const styles = stylesFor(arabic)
  const notes = new Map((analysis?.steps ?? []).map((note) => [note.stepId, note]))
  return (
    <View>
      <Text style={styles.h1}>{project.name}</Text>
      {project.description ? <Text style={styles.body}>{clip(project.description, 500)}</Text> : null}
      <Text style={styles.h2}>{t('reports.roadmap.pdf.projectMetrics')}</Text>
      <ProjectMetrics project={project} t={t} styles={styles} />
      <Text style={styles.h2}>{t('reports.roadmap.pdf.stepsTitle')}</Text>
      {project.steps.length ? (
        project.steps.map((step, index) => {
          const note = notes.get(step.id)
          const look = nodeLook(step, note)
          const last = index === project.steps.length - 1
          return (
            <View key={step.id} style={styles.timelineRow} wrap={false}>
              <View style={styles.gutter}>
                <Node step={step} note={note} styles={styles} />
                {last ? null : <View style={styles.connector} />}
              </View>
              <View style={styles.timelineBody}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.stepTitle}>{clip(step.title, 140)}</Text>
                  <Text style={[styles.chip, laneStyle(step.stage)]}>{t(`reports.roadmap.stage.${step.stage}`)}</Text>
                  {note ? (
                    <Text style={[styles.chip, { color: look.border === HILM.mutedSoft ? HILM.body : look.border, borderWidth: 1, borderColor: look.border }]}>
                      {t(`reports.roadmap.readiness.${note.readiness}`)}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.small}>
                  {[
                    step.completedAt ? t('reports.roadmap.pdf.completedOn', { date: formatDate(step.completedAt, arabic) }) : '',
                    step.startsAt || step.endsAt
                      ? t('reports.roadmap.pdf.window', { start: formatDate(step.startsAt, arabic) || '…', end: formatDate(step.endsAt, arabic) || '…' })
                      : '',
                    step.createdAt && step.stage !== 'done' ? t('reports.roadmap.pdf.added', { date: formatDate(step.createdAt, arabic) }) : '',
                    note ? t('reports.roadmap.pdf.relatedTasks', { count: note.relatedTasks }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {step.description ? <Text style={[styles.body, { marginTop: 3, marginBottom: 2 }]}>{clip(step.description, 420)}</Text> : null}
                {note?.note ? (
                  <Text style={[styles.body, { marginTop: 2, color: HILM.ink }]}>
                    <Text style={{ color: HILM.muted }}>{t('reports.roadmap.pdf.aiLabel')} · </Text>
                    {note.note}
                  </Text>
                ) : null}
              </View>
            </View>
          )
        })
      ) : (
        <Text style={styles.body}>{t('reports.roadmap.pdf.noSteps')}</Text>
      )}
    </View>
  )
}

export function RoadmapAnalysisSection({
  project,
  analysis,
  aiError,
  t,
  arabic,
}: {
  project: RoadmapReportProject
  analysis?: ProjectAnalysis
  aiError: string | null
  t: TFunction
  arabic: boolean
}) {
  const styles = stylesFor(arabic)
  if (!analysis) {
    return (
      <View>
        <Text style={styles.h2}>{t('reports.roadmap.pdf.analysisTitle')}</Text>
        <View style={styles.notice}>
          <Text style={styles.body}>
            {aiError
              ? t('reports.roadmap.pdf.aiUnavailable', { reason: roadmapAiReason(aiError, t) })
              : t('reports.roadmap.pdf.aiOff')}
          </Text>
        </View>
      </View>
    )
  }
  return (
    <View>
      <Text style={styles.h2} break={project.steps.length > 6}>
        {t('reports.roadmap.pdf.analysisTitle')} · {project.name}
      </Text>
      <View style={styles.statusRow}>
        <Text style={[styles.chip, { color: HILM.paper, backgroundColor: statusColor(analysis.status) }]}>
          {t(`reports.roadmap.status.${analysis.status}`)}
        </Text>
        <Text style={styles.small}>{t('reports.roadmap.pdf.confidence')}</Text>
        <View style={styles.barTrack}>
          <View style={{ width: `${analysis.confidence}%`, height: 6, borderRadius: 3, backgroundColor: statusColor(analysis.status) }} />
        </View>
        <Text style={styles.small}>{analysis.confidence}%</Text>
      </View>
      {analysis.summary ? <Text style={styles.body}>{analysis.summary}</Text> : null}

      {analysis.progressAssessment ? (
        <View wrap={false}>
          <Text style={styles.h3}>{t('reports.roadmap.pdf.progress')}</Text>
          <Text style={styles.body}>{analysis.progressAssessment}</Text>
        </View>
      ) : null}

      {analysis.strengths.length ? (
        <View wrap={false}>
          <Text style={styles.h3}>{t('reports.roadmap.pdf.strengths')}</Text>
          {analysis.strengths.map((line, index) => (
            <Text key={index} style={styles.bullet}>
              • {line}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.risks.length ? (
        <View>
          <Text style={styles.h3}>{t('reports.roadmap.pdf.risks')}</Text>
          <View style={styles.riskHead} wrap={false}>
            <Text style={[styles.th, { width: 62 }]}>{t('reports.roadmap.pdf.severity')}</Text>
            <Text style={[styles.th, { width: 130 }]}>{t('reports.roadmap.pdf.risk')}</Text>
            <Text style={[styles.th, { flexGrow: 1, flexBasis: 0 }]}>{t('reports.roadmap.pdf.why')}</Text>
          </View>
          {analysis.risks.map((risk, index) => (
            <View key={index} style={styles.riskRow} wrap={false}>
              <Text style={[styles.td, { width: 62, color: severityColor(risk.severity) }]}>{t(`reports.roadmap.severity.${risk.severity}`)}</Text>
              <Text style={[styles.td, { width: 130, color: HILM.ink }]}>{risk.title}</Text>
              <Text style={[styles.td, { flexGrow: 1, flexBasis: 0 }]}>{risk.detail}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {analysis.gaps.length ? (
        <View wrap={false}>
          <Text style={styles.h3}>{t('reports.roadmap.pdf.gaps')}</Text>
          {analysis.gaps.map((line, index) => (
            <Text key={index} style={styles.bullet}>
              • {line}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.nextActions.length ? (
        <View wrap={false}>
          <Text style={styles.h3}>{t('reports.roadmap.pdf.nextActions')}</Text>
          {analysis.nextActions.map((line, index) => (
            <Text key={index} style={styles.bullet}>
              {index + 1}. {line}
            </Text>
          ))}
        </View>
      ) : null}

      {analysis.outlook ? (
        <View wrap={false}>
          <Text style={styles.h3}>{t('reports.roadmap.pdf.outlook')}</Text>
          <Text style={styles.body}>{analysis.outlook}</Text>
        </View>
      ) : null}
    </View>
  )
}

export function RoadmapClosing({
  data,
  t,
  arabic,
  generatedAt,
}: {
  data: RoadmapReportData
  t: TFunction
  arabic: boolean
  generatedAt: string
}) {
  const styles = stylesFor(arabic)
  const analysis = data.analysis
  return (
    <View>
      {analysis?.overview ? (
        <View>
          <Text style={styles.h1}>{t('reports.roadmap.pdf.overview')}</Text>
          <Text style={styles.body}>{analysis.overview}</Text>
        </View>
      ) : null}
      {analysis?.recommendations.length ? (
        <View>
          <Text style={styles.h2}>{t('reports.roadmap.pdf.recommendations')}</Text>
          {analysis.recommendations.map((line, index) => (
            <Text key={index} style={styles.bullet}>
              {index + 1}. {line}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={styles.notice}>
        <Text style={styles.small}>
          {analysis
            ? t('reports.roadmap.pdf.aiNote', { date: formatDate(generatedAt, arabic) })
            : data.aiError
              ? t('reports.roadmap.pdf.aiUnavailable', { reason: roadmapAiReason(data.aiError, t) })
              : t('reports.roadmap.pdf.aiOff')}
        </Text>
      </View>
    </View>
  )
}
