import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getReportType, metricsForOs } from '@/features/reports/catalog'
import { listLocalizedReportTypes, localizedMetricLabel, localizedReportType } from '@/features/reports/i18n'
import { customizeReportFromPrompt } from '@/features/reports/engine/aiCustomize'
import { buildReportSnapshot } from '@/features/reports/engine/buildSnapshot'
import type {
  ReportSourceMember,
  ReportSourceProject,
  ReportSourceTask,
} from '@/features/reports/engine/buildSnapshot'
import { defaultConfig } from '@/features/reports/api'
import { ReportPdfPreview } from '@/features/reports/components/ReportPdfPreview'
import { downloadReportPdf } from '@/features/reports/pdf/exportPdf'
import type {
  DateRangePreset,
  MetricId,
  ReportConfig,
  ReportOs,
  ReportSnapshot,
  ReportTypeId,
} from '@/features/reports/types'
import { cn } from '@/lib/utils'

export type ReportStudioProps = {
  os: ReportOs
  generatedBy: string
  workspaceName?: string | null
  workspaceId?: string | null
  logoUrl?: string | null
  projects: ReportSourceProject[]
  tasks: ReportSourceTask[]
  members?: ReportSourceMember[]
  departments?: Array<{ id: string; name: string }>
  teams?: Array<{ id: string; name: string }>
  onGenerate: (snapshot: ReportSnapshot) => Promise<unknown>
  generating?: boolean
  reopenSnapshot?: ReportSnapshot | null
  onClearReopen?: () => void
}

const DATE_PRESETS: DateRangePreset[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'custom',
]

type Step = 'type' | 'configure' | 'preview'

export function ReportStudio(props: ReportStudioProps) {
  const { t, i18n } = useTranslation()
  const [step, setStep] = useState<Step>(props.reopenSnapshot ? 'preview' : 'type')
  const [config, setConfig] = useState<ReportConfig>(() => ({
    ...defaultConfig(props.os),
    locale: i18n.language?.startsWith('ar') ? 'ar' : 'en',
  }))
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiNotes, setAiNotes] = useState<string[]>([])
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(props.reopenSnapshot ?? null)
  const [busy, setBusy] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)

  useEffect(() => {
    if (props.reopenSnapshot) {
      setSnapshot(props.reopenSnapshot)
      setStep('preview')
    }
  }, [props.reopenSnapshot])

  const types = useMemo(() => listLocalizedReportTypes(props.os, t), [props.os, t])
  const typeDef = localizedReportType(props.os, config.typeId, t)
  const metricOptions = useMemo(
    () =>
      metricsForOs(props.os).map((metric) => ({
        ...metric,
        label: localizedMetricLabel(metric.id, t),
      })),
    [props.os, t],
  )

  function patchConfig(patch: Partial<ReportConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }))
  }

  function selectType(typeId: ReportTypeId) {
    const def = getReportType(props.os, typeId)
    setConfig((prev) => ({
      ...prev,
      typeId,
      metrics: def.defaultMetrics,
      datePreset:
        typeId === 'weekly_productivity'
          ? 'this_week'
          : typeId === 'monthly_productivity'
            ? 'this_month'
            : prev.datePreset,
    }))
    setStep('configure')
  }

  function applyAiCustomize() {
    if (!aiPrompt.trim()) return
    const result = customizeReportFromPrompt(props.os, aiPrompt, config)
    setConfig(result.config)
    setAiNotes(result.notes)
    setAiPrompt(result.config.aiPrompt ?? aiPrompt)
  }

  function toggleMetric(id: MetricId) {
    setConfig((prev) => {
      const has = prev.metrics.includes(id)
      return {
        ...prev,
        metrics: has ? prev.metrics.filter((m) => m !== id) : [...prev.metrics, id],
      }
    })
  }

  function toggleId(
    key: 'projectIds' | 'departmentIds' | 'teamIds' | 'memberIds',
    id: string,
    allLabel: 'all',
  ) {
    setConfig((prev) => {
      const current = prev[key] ?? allLabel
      if (current === 'all') return { ...prev, [key]: [id] }
      const list = current as string[]
      if (list.includes(id)) {
        const next = list.filter((x) => x !== id)
        return { ...prev, [key]: next.length ? next : 'all' }
      }
      return { ...prev, [key]: [...list, id] }
    })
  }

  async function generatePreview() {
    setBusy(true)
    try {
      const next = buildReportSnapshot({
        os: props.os,
        config: {
          ...config,
          metrics: config.metrics.length ? config.metrics : typeDef.defaultMetrics,
          locale: i18n.language?.startsWith('ar') ? 'ar' : 'en',
        },
        generatedBy: props.generatedBy,
        workspaceName: props.workspaceName,
        workspaceId: props.workspaceId,
        logoUrl: props.logoUrl,
        projects: props.projects,
        tasks: props.tasks,
        members: props.members,
        aiPromptNotes: aiNotes,
      })
      setSnapshot(next)
      setStep('preview')
      props.onClearReopen?.()
    } finally {
      setBusy(false)
    }
  }

  async function saveAndKeep() {
    if (!snapshot) return
    await props.onGenerate(snapshot)
  }

  async function handleDownload() {
    if (!snapshot) return
    setDownloadBusy(true)
    try {
      await downloadReportPdf(snapshot)
    } finally {
      setDownloadBusy(false)
    }
  }

  const steps: Array<{ id: Step; label: string }> = [
    { id: 'type', label: t('reports.stepType', { defaultValue: 'Type' }) },
    { id: 'configure', label: t('reports.stepConfigure', { defaultValue: 'Configure' }) },
    { id: 'preview', label: t('reports.stepPreview', { defaultValue: 'Preview' }) },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {steps.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id === 'preview' && !snapshot) return
              if (item.id === 'configure' && !config.typeId) return
              setStep(item.id)
            }}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs transition-colors',
              step === item.id
                ? 'bg-accent/20 text-foreground'
                : 'bg-surface-2 text-muted hover:text-foreground',
            )}
          >
            {index + 1}. {item.label}
          </button>
        ))}
      </div>

      {step === 'type' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {types.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectType(item.id)}
              className={cn(
                'rounded-2xl border border-border-subtle bg-surface/40 p-4 text-start transition-colors hover:border-border hover:bg-surface',
                config.typeId === item.id && 'border-accent/40 bg-accent/5',
              )}
            >
              <p className="text-sm font-medium">{item.title}</p>
              <p className="mt-1 text-xs text-muted">{item.description}</p>
            </button>
          ))}
        </div>
      ) : null}

      {step === 'configure' ? (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>{typeDef.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label={t('reports.reportTitle', { defaultValue: 'Report title' })}>
                <input
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                  value={config.title ?? ''}
                  placeholder={typeDef.title}
                  onChange={(e) => patchConfig({ title: e.target.value })}
                />
              </Field>

              <Field label={t('reports.dateRange', { defaultValue: 'Date range' })}>
                <select
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                  value={config.datePreset}
                  onChange={(e) => patchConfig({ datePreset: e.target.value as DateRangePreset })}
                >
                  {DATE_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {t(`reports.presets.${preset}`, {
                        defaultValue: preset.replace(/_/g, ' '),
                      })}
                    </option>
                  ))}
                </select>
              </Field>

              {config.datePreset === 'custom' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('reports.startDate', { defaultValue: 'Start' })}>
                    <input
                      type="date"
                      className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                      value={config.customStart ?? ''}
                      onChange={(e) => patchConfig({ customStart: e.target.value })}
                    />
                  </Field>
                  <Field label={t('reports.endDate', { defaultValue: 'End' })}>
                    <input
                      type="date"
                      className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                      value={config.customEnd ?? ''}
                      onChange={(e) => patchConfig({ customEnd: e.target.value })}
                    />
                  </Field>
                </div>
              ) : null}

              <MultiSelect
                label={t('reports.projects', { defaultValue: 'Projects' })}
                allSelected={config.projectIds === 'all'}
                onSelectAll={() => patchConfig({ projectIds: 'all' })}
                options={props.projects.map((p) => ({ id: p.id, name: p.name }))}
                selected={config.projectIds === 'all' ? [] : config.projectIds}
                onToggle={(id) => toggleId('projectIds', id, 'all')}
              />

              {props.os === 'workspace' && typeDef.needsDepartments && props.departments?.length ? (
                <MultiSelect
                  label={t('reports.departments', { defaultValue: 'Departments' })}
                  allSelected={(config.departmentIds ?? 'all') === 'all'}
                  onSelectAll={() => patchConfig({ departmentIds: 'all' })}
                  options={props.departments}
                  selected={config.departmentIds === 'all' || !config.departmentIds ? [] : config.departmentIds}
                  onToggle={(id) => toggleId('departmentIds', id, 'all')}
                />
              ) : null}

              {props.os === 'workspace' && typeDef.needsTeams && props.teams?.length ? (
                <MultiSelect
                  label={t('reports.teams', { defaultValue: 'Teams' })}
                  allSelected={(config.teamIds ?? 'all') === 'all'}
                  onSelectAll={() => patchConfig({ teamIds: 'all' })}
                  options={props.teams}
                  selected={config.teamIds === 'all' || !config.teamIds ? [] : config.teamIds}
                  onToggle={(id) => toggleId('teamIds', id, 'all')}
                />
              ) : null}

              {props.os === 'workspace' && typeDef.needsMembers && props.members?.length ? (
                <MultiSelect
                  label={t('reports.members', { defaultValue: 'Members' })}
                  allSelected={(config.memberIds ?? 'all') === 'all'}
                  onSelectAll={() => patchConfig({ memberIds: 'all' })}
                  options={props.members.map((m) => ({ id: m.id, name: m.name }))}
                  selected={config.memberIds === 'all' || !config.memberIds ? [] : config.memberIds}
                  onToggle={(id) => toggleId('memberIds', id, 'all')}
                />
              ) : null}

              <div>
                <p className="mb-2 text-xs text-muted">
                  {t('reports.metrics', { defaultValue: 'Metrics' })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {metricOptions.map((metric) => {
                    const active = (config.metrics.length ? config.metrics : typeDef.defaultMetrics).includes(
                      metric.id,
                    )
                    return (
                      <button
                        key={metric.id}
                        type="button"
                        onClick={() => toggleMetric(metric.id)}
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px]',
                          active ? 'bg-accent/20 text-foreground' : 'bg-surface-2 text-muted',
                        )}
                      >
                        {metric.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setStep('type')}>
                  {t('common.back', { defaultValue: 'Back' })}
                </Button>
                <Button type="button" disabled={busy} onClick={() => void generatePreview()}>
                  <Wand2 className="size-4" />
                  {busy
                    ? t('reports.generating', { defaultValue: 'Generating…' })
                    : t('reports.generatePreview', { defaultValue: 'Generate preview' })}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-accent" />
                {t('reports.askAi', { defaultValue: 'Ask AI to customize this report' })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                className="min-h-32 w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={
                  props.os === 'workspace'
                    ? t('reports.aiPlaceholderWorkspace', {
                        defaultValue:
                          'Create an executive report showing Engineering workload, overdue tasks, project progress, and bottlenecks this week.',
                      })
                    : t('reports.aiPlaceholderPersonal', {
                        defaultValue:
                          'Create a weekly productivity report showing where I spent most of my time, what I completed, what I’m behind on, and what to prioritize next week.',
                      })
                }
              />
              <Button type="button" size="sm" variant="secondary" onClick={applyAiCustomize}>
                <Sparkles className="size-4" />
                {t('reports.applyAi', { defaultValue: 'Apply AI customization' })}
              </Button>
              {aiNotes.length ? (
                <ul className="space-y-1 text-xs text-muted">
                  {aiNotes.map((note) => (
                    <li key={note}>• {note}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[11px] text-muted">
                {t('reports.aiDisclaimer', {
                  defaultValue:
                    'AI only configures structure and emphasis. All numbers come from your Hilm data.',
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {step === 'preview' && snapshot ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep('configure')}>
              {t('reports.editConfig', { defaultValue: 'Edit configuration' })}
            </Button>
            <Button type="button" disabled={props.generating} onClick={() => void saveAndKeep()}>
              {props.generating
                ? t('reports.saving', { defaultValue: 'Saving…' })
                : t('reports.saveHistory', { defaultValue: 'Save to history' })}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={downloadBusy}
              onClick={() => void handleDownload()}
            >
              <Download className="size-4" />
              {t('reports.downloadPdf', { defaultValue: 'Download PDF' })}
            </Button>
          </div>
          <p className="text-xs text-muted">
            {t('reports.previewHint', {
              defaultValue: 'Preview uses the same PDF document as the download.',
            })}
          </p>
          <ReportPdfPreview snapshot={snapshot} />
        </div>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      {children}
    </div>
  )
}

function MultiSelect({
  label,
  options,
  selected,
  allSelected,
  onSelectAll,
  onToggle,
}: {
  label: string
  options: Array<{ id: string; name: string }>
  selected: string[]
  allSelected: boolean
  onSelectAll: () => void
  onToggle: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{label}</p>
        <button type="button" className="text-[11px] text-accent" onClick={onSelectAll}>
          {t('reports.allAccessible', { defaultValue: 'All accessible' })}
        </button>
      </div>
      <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border-subtle p-2">
        {options.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted">—</p>
        ) : (
          options.map((option) => {
            const active = allSelected || selected.includes(option.id)
            return (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => {
                    if (allSelected) onToggle(option.id)
                    else onToggle(option.id)
                  }}
                />
                <span className="truncate">{option.name}</span>
              </label>
            )
          })
        )}
      </div>
      {allSelected ? (
        <p className="mt-1 text-[11px] text-muted">
          {t('reports.allSelected', { defaultValue: 'All accessible items included' })}
        </p>
      ) : null}
    </div>
  )
}
