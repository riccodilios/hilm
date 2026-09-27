import type { ReportSnapshot } from '@/shared/reports/types'
import { formatClock, speakerName } from './format'
import type { MeetingDetail } from './types'

type T = (key: string, options?: Record<string, unknown>) => string

function ownerLabel(detail: MeetingDetail, speakerId: string | null, t: T) {
  if (!speakerId) return t('meetings.actions.noOwner')
  const speaker = detail.speakers.find((s) => s.id === speakerId)
  return speakerName(speaker, t('meetings.transcript.unknownSpeaker'))
}

export function buildMeetingMarkdown(detail: MeetingDetail, context: { projectName: string; t: T; locale: string }) {
  const { meeting } = detail
  const { t } = context
  const when = meeting.heldAt ?? meeting.startedAt ?? meeting.createdAt
  const lines: string[] = [
    `# ${meeting.title}`,
    '',
    `${t('meetings.export.project')}: ${context.projectName}`,
    `${t('meetings.export.date')}: ${new Date(when).toLocaleString(context.locale)}`,
  ]
  if (meeting.durationSeconds) lines.push(`${t('meetings.export.duration')}: ${formatClock(meeting.durationSeconds * 1000)}`)
  if (meeting.participants.length) lines.push(`${t('meetings.fields.participants')}: ${meeting.participants.join(', ')}`)
  if (meeting.summary) lines.push('', `## ${t('meetings.summary.title')}`, '', meeting.summary)
  if (meeting.keyPoints.length) {
    lines.push('', `## ${t('meetings.summary.keyPoints')}`, '', ...meeting.keyPoints.map((point) => `- ${point}`))
  }
  if (detail.decisions.length) {
    lines.push(
      '',
      `## ${t('meetings.summary.decisions')}`,
      '',
      ...detail.decisions.map(
        (decision) => `- ${decision.text}${decision.certainty === 'uncertain' ? ` (${t('meetings.certainty.uncertain')})` : ''}`,
      ),
    )
  }
  if (detail.actionItems.length) {
    lines.push('', `## ${t('meetings.actions.title')}`, '')
    for (const item of detail.actionItems) {
      const meta = [
        ownerLabel(detail, item.ownerSpeakerId, t),
        item.dueText || item.dueDate || null,
        item.certainty === 'possible' ? t('meetings.certainty.possible') : null,
      ].filter(Boolean)
      lines.push(`- [${item.taskId ? 'x' : ' '}] ${item.title} — ${meta.join(' · ')}`)
    }
  }
  if (detail.transcript.length) {
    const speakers = new Map(detail.speakers.map((speaker) => [speaker.id, speaker]))
    lines.push('', `## ${t('meetings.transcript.title')}`, '')
    for (const segment of detail.transcript) {
      const speaker = segment.speakerId ? speakers.get(segment.speakerId) : undefined
      lines.push(
        `**[${formatClock(segment.startMs)}] ${speakerName(speaker, t('meetings.transcript.unknownSpeaker'))}:** ${segment.text}`,
      )
    }
  }
  return lines.join('\n')
}

export function buildMeetingSnapshot(
  detail: MeetingDetail,
  context: { projectName: string; t: T; locale: 'en' | 'ar'; generatedBy: string; os: 'personal' | 'workspace'; workspaceName?: string | null },
): ReportSnapshot {
  const { meeting } = detail
  const { t } = context
  const speakers = new Map(detail.speakers.map((speaker) => [speaker.id, speaker]))
  const when = (meeting.heldAt ?? meeting.startedAt ?? meeting.createdAt).slice(0, 10)
  return {
    version: 1,
    os: context.os,
    typeId: 'custom',
    title: meeting.title,
    periodStart: when,
    periodEnd: when,
    generatedAt: new Date().toISOString(),
    generatedBy: context.generatedBy,
    workspaceName: context.workspaceName ?? null,
    branding: { productName: 'Hilm', accent: '#60a5fa' },
    executiveSummary: meeting.summary || t('meetings.summary.empty'),
    metrics: [
      { id: 'project_count', label: t('meetings.export.project'), value: context.projectName },
      { id: 'open_tasks', label: t('meetings.export.duration'), value: formatClock(meeting.durationSeconds * 1000) },
      { id: 'tasks_created', label: t('meetings.actions.title'), value: detail.actionItems.length },
      { id: 'tasks_completed', label: t('meetings.summary.decisions'), value: detail.decisions.length },
    ],
    charts: [],
    tables: [
      {
        title: t('meetings.summary.decisions'),
        headers: [t('meetings.export.decision'), t('meetings.export.certainty')],
        rows: detail.decisions.map((decision) => [decision.text, t(`meetings.certainty.${decision.certainty}`)]),
      },
      {
        title: t('meetings.actions.title'),
        headers: [t('meetings.export.item'), t('meetings.actions.owner'), t('meetings.actions.due'), t('meetings.export.task')],
        rows: detail.actionItems.map((item) => [
          item.title,
          ownerLabel(detail, item.ownerSpeakerId, t),
          item.dueText || item.dueDate || '—',
          item.taskId ? t('meetings.actions.taskCreated') : '—',
        ]),
      },
      {
        title: t('meetings.transcript.title'),
        headers: [t('meetings.export.time'), t('meetings.export.speaker'), t('meetings.export.text')],
        rows: detail.transcript.map((segment) => [
          formatClock(segment.startMs),
          speakerName(segment.speakerId ? speakers.get(segment.speakerId) : undefined, '—'),
          segment.text,
        ]),
      },
    ],
    insights: meeting.keyPoints,
    recommendations: [],
    sections: ['cover', 'executive_summary', 'key_metrics', 'ai_insights', 'appendix'],
    config: {
      typeId: 'custom',
      title: meeting.title,
      datePreset: 'custom',
      customStart: when,
      customEnd: when,
      projectIds: meeting.projectId ? [meeting.projectId] : 'all',
      metrics: [],
      locale: context.locale,
    },
  }
}

export async function downloadMeetingPdf(snapshot: ReportSnapshot) {
  const { downloadReportPdf } = await import('@/shared/reports/pdf/exportPdf')
  await downloadReportPdf(snapshot, `meeting-${snapshot.title}`)
}

export function downloadMarkdown(markdown: string, title: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().slice(0, 80) || 'meeting'}.md`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
