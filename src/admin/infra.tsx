import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { adminApi, usd, when } from '@/admin/client'
import { Bars, Loading, Panel, Table, errorText } from '@/admin/pages'

// ── Types and formatting ─────────────────────────────────────────────────────

type Quality = 'provider_live' | 'provider_synced' | 'app_calculated' | 'estimated' | 'manual' | 'unavailable'

type Metric = {
  metric: string
  scope: string
  value: number | null
  unit: string
  source: string
  quality: Quality
  details: unknown
  collected_at: string
  frequencyMinutes: number | null
  stale: boolean
}

type Limit = { key: string; label: string; limit_value: string | number | null; unit: string; plan: string | null; quality: Quality; source: string; verified_at: string | null; notes: string | null }
type Alert = { id: string; rule_key: string; level: 'warning' | 'critical'; value: number | null; threshold: number | null; message: string; opened_at: string; last_notified_at: string | null; resolved_at?: string | null }
type Collector = { collector: string; interval_minutes: number; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null }
type Run = { id: string; trigger: string; mode: string; status: string; started_at: string; finished_at: string | null; stats: Record<string, unknown>; error: string | null }
type Settings = Record<string, string | number | boolean | null>

type Overview = { metrics: Metric[]; limits: Limit[]; alerts: Alert[]; collectors: Collector[]; runs: Run[]; settings: Settings }

const QUALITY: Record<Quality, { label: string; tone: string; help: string }> = {
  provider_live: { label: 'Live', tone: 'bg-emerald-500/15 text-emerald-300', help: 'Read directly from the provider at collection time' },
  provider_synced: { label: 'Provider', tone: 'bg-sky-500/15 text-sky-300', help: 'Provider usage API (the provider updates it periodically)' },
  app_calculated: { label: 'Calculated', tone: 'bg-violet-500/15 text-violet-300', help: 'Computed by Hilm from its own records' },
  estimated: { label: 'Estimate', tone: 'bg-amber-500/15 text-amber-300', help: 'Derived from stated assumptions' },
  manual: { label: 'Manual', tone: 'bg-zinc-500/20 text-zinc-300', help: 'Entered by an admin from a provider dashboard' },
  unavailable: { label: 'Unavailable', tone: 'bg-red-500/15 text-red-300', help: 'No source exists; nothing is guessed' },
}

export function bytes(value: unknown) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.abs(n)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${n < 0 ? '-' : ''}${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatValue(value: number | null | undefined, unit: string) {
  if (value == null) return '—'
  switch (unit) {
    case 'bytes':
      return bytes(value)
    case 'usd':
      return usd(value)
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'seconds':
      return value >= 3600 ? `${(value / 3600).toFixed(1)} h` : `${Math.round(value)} s`
    case 'hours':
      return `${value.toFixed(value < 10 ? 2 : 1)} h`
    case 'ratio':
      return `${value.toFixed(2)}×`
    default:
      return Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })
  }
}

const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never'
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / 1440)} d ago`
}

function QualityBadge({ quality, stale }: { quality: Quality; stale?: boolean }) {
  const q = QUALITY[quality] ?? QUALITY.unavailable
  return (
    <span className="inline-flex items-center gap-1">
      <span title={q.help} className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', q.tone)}>
        {q.label}
      </span>
      {stale ? <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-300">Stale</span> : null}
    </span>
  )
}

function MetricCard({ title, metric, limit, unit, note }: { title: string; metric?: Metric; limit?: number | null; unit?: string; note?: ReactNode }) {
  const value = metric?.value ?? null
  const u = metric?.unit ?? unit ?? ''
  const pct = value != null && limit ? (value / limit) * 100 : null
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted">{title}</p>
        {metric ? <QualityBadge quality={metric.quality} stale={metric.stale} /> : <QualityBadge quality="unavailable" />}
      </div>
      <p className="mt-1 text-2xl font-medium tracking-tight">{formatValue(value, u)}</p>
      {limit ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn('h-full rounded-full', (pct ?? 0) >= 90 ? 'bg-red-400' : (pct ?? 0) >= 70 ? 'bg-amber-400' : 'bg-emerald-400')}
              style={{ width: `${Math.min(100, pct ?? 0)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            {pct != null ? `${pct.toFixed(1)}% of ${formatValue(limit, u)}` : `Limit ${formatValue(limit, u)}`}
          </p>
        </>
      ) : null}
      <p className="mt-2 text-[11px] leading-4 text-muted">
        {metric ? (
          <>
            {metric.source}
            <br />
            Collected {ago(metric.collected_at)}
            {metric.frequencyMinutes ? ` · every ${metric.frequencyMinutes >= 1440 ? 'day' : `${metric.frequencyMinutes} min`}` : ''}
          </>
        ) : (
          'No data collected yet'
        )}
      </p>
      {note ? <p className="mt-1 text-[11px] text-muted">{note}</p> : null}
    </div>
  )
}

const pick = (metrics: Metric[] | undefined, key: string, scope = 'global') => metrics?.find((m) => m.metric === key && m.scope === scope)
const limitOf = (limits: Limit[] | undefined, key: string) => {
  const row = limits?.find((l) => l.key === key)
  return row?.limit_value != null ? Number(row.limit_value) : null
}

function useOverview() {
  return useQuery({ queryKey: ['admin', 'infra', 'overview'], queryFn: () => adminApi<Overview>('infra/overview'), refetchInterval: 60_000 })
}

function useActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'infra'] })
  const collect = useMutation({
    mutationFn: () => adminApi<{ result: { written: number; errors: string[] } }>('infra/collect', { method: 'POST', body: {} }),
    onSuccess: async (r) => {
      toast.success(`Collected ${r.result.written} metrics${r.result.errors.length ? ` · ${r.result.errors.length} source(s) failed` : ''}`)
      await refresh()
    },
    onError: (e) => toast.error(errorText(e)),
  })
  const run = useMutation({
    mutationFn: () => adminApi<{ result: Record<string, unknown> }>('infra/lifecycle/run', { method: 'POST', body: {} }),
    onSuccess: async (r) => {
      const result = r.result
      toast.success(result.skipped ? `Skipped: ${String(result.skipped)}` : `Lifecycle run ${String(result.status)} (${String(result.mode)})`)
      await refresh()
    },
    onError: (e) => toast.error(errorText(e)),
  })
  return { collect, run, refresh }
}

// ── Page ─────────────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Storage', 'Database', 'Services', 'Forecasting', 'Operations'] as const
type Tab = (typeof TABS)[number]

export function InfrastructurePage() {
  const [tab, setTab] = useState<Tab>('Overview')
  const { collect, run } = useActions()
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-xl border border-border bg-surface-2/60 p-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', tab === t ? 'bg-surface text-foreground shadow-sm' : 'text-muted')}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={collect.isPending} onClick={() => collect.mutate()}>
            {collect.isPending ? 'Collecting…' : 'Collect metrics now'}
          </Button>
          <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Running…' : 'Run lifecycle now'}
          </Button>
        </div>
      </div>
      {tab === 'Overview' ? <OverviewTab /> : null}
      {tab === 'Storage' ? <StorageTab /> : null}
      {tab === 'Database' ? <DatabaseTab /> : null}
      {tab === 'Services' ? <ServicesTab /> : null}
      {tab === 'Forecasting' ? <ForecastTab /> : null}
      {tab === 'Operations' ? <OperationsTab /> : null}
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────

function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="text-sm text-muted">No open alerts.</p>
  return (
    <ul className="space-y-2">
      {alerts.map((a) => (
        <li key={a.id} className={cn('rounded-xl border px-3 py-2 text-sm', a.level === 'critical' ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10')}>
          <p className="font-medium">{a.message}</p>
          <p className="text-xs text-muted">
            {a.level} · opened {ago(a.opened_at)}
            {a.resolved_at ? ` · resolved ${ago(a.resolved_at)}` : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}

function OverviewTab() {
  const q = useOverview()
  const d = q.data
  const m = d?.metrics
  const l = d?.limits
  const lifecycle = d?.collectors.find((c) => c.collector === 'lifecycle')
  return (
    <div className="space-y-5">
      <Loading q={q} />
      {d ? (
        <>
          <Panel title="Open alerts">
            <AlertList alerts={d.alerts} />
          </Panel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Supabase database" metric={pick(m, 'supabase.db_size_bytes')} limit={limitOf(l, 'supabase.db_size')} />
            <MetricCard title="Supabase Storage" metric={pick(m, 'supabase.storage_bytes')} limit={limitOf(l, 'supabase.storage')} />
            <MetricCard
              title="Supabase egress"
              metric={pick(m, 'supabase.egress_bytes')}
              limit={limitOf(l, 'supabase.egress')}
              unit="bytes"
              note="No API exposes egress. Enter it from the Supabase dashboard (Services tab)."
            />
            <MetricCard title="Netlify function invocations" metric={pick(m, 'netlify.function_invocations')} limit={limitOf(l, 'netlify.function_invocations')} />
            <MetricCard title="Netlify function runtime" metric={pick(m, 'netlify.function_runtime_seconds')} limit={limitOf(l, 'netlify.function_runtime')} />
            <MetricCard title="Netlify bandwidth" metric={pick(m, 'netlify.bandwidth_bytes')} limit={limitOf(l, 'netlify.bandwidth')} />
            <MetricCard title="AI spend today" metric={pick(m, 'ai.spend_today_usd')} note={`Month: ${formatValue(pick(m, 'ai.spend_month_usd')?.value, 'usd')}`} />
            <MetricCard title="Soniox this month" metric={pick(m, 'soniox.cost_month_usd')} note={`${formatValue(pick(m, 'soniox.audio_hours_month')?.value, 'hours')} transcribed`} />
            <MetricCard title="Emails today" metric={pick(m, 'email.sent_today')} limit={limitOf(l, 'resend.daily_emails')} />
            <MetricCard title="Deletions waiting" metric={pick(m, 'storage.queue_pending')} note={`${formatValue(pick(m, 'storage.queue_failed')?.value, 'files')} failed permanently`} />
            <MetricCard title="Organizations" metric={pick(m, 'app.workspaces')} note={`${formatValue(pick(m, 'app.users')?.value, 'users')} users · ${formatValue(pick(m, 'app.active_users_7d')?.value, 'users')} active (7 d)`} />
            <MetricCard title="Database connections" metric={pick(m, 'supabase.db_connections')} limit={Number((pick(m, 'supabase.db_connections')?.details as { max_connections?: number } | undefined)?.max_connections ?? 0) || null} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Storage lifecycle">
              <p className="text-sm">
                Mode: <span className="font-medium">{String(d.settings.mode)}</span> · last run {ago(lifecycle?.last_success_at)}
              </p>
              {lifecycle?.last_error ? <p className="mt-1 text-xs text-red-300">{lifecycle.last_error}</p> : null}
              <RunsTable runs={d.runs} />
            </Panel>
            <Panel title="Collectors">
              <Table
                head={['Job', 'Every', 'Last success', 'Last error']}
                rows={d.collectors.map((c) => [c.collector, `${c.interval_minutes} min`, ago(c.last_success_at), c.last_error ?? '—'])}
              />
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  )
}

function RunsTable({ runs }: { runs: Run[] }) {
  return (
    <Table
      head={['Started', 'Mode', 'Status', 'Summary']}
      rows={runs.map((r) => [
        when(r.started_at),
        r.mode,
        r.status,
        <span key="s" className="font-mono text-[11px] text-muted">
          {Object.entries(r.stats ?? {})
            .filter(([, v]) => typeof v === 'number' && v !== 0)
            .map(([k, v]) => `${k}=${k.endsWith('bytes') ? bytes(v) : String(v)}`)
            .join(' ') || '—'}
          {r.error ? ` · ${r.error}` : ''}
        </span>,
      ])}
    />
  )
}

// ── Storage ──────────────────────────────────────────────────────────────────

type StorageData = {
  inventory: { details: Record<string, unknown>; collected_at: string } | null
  settings: Settings
  policies: Array<{ id: string; scope_type: string; scope_id: string | null; scope_name: string | null; category: string; retention_days: number | null; legal_hold: boolean; set_by: string; updated_at: string }>
  quotas: Array<{ scope_type: string; scope_id: string; scope_name: string | null; max_bytes: number; updated_at: string }>
  topUsage: Array<{ scope_type: string; scope_id: string; scope_name: string | null; category: string; files_active: number; bytes_active: number; bytes_pending: number }>
  legalHolds: Array<{ id: string; category: string; original_filename: string | null; size_bytes: number; status: string }>
  failedDeletions: Array<{ id: string; provider: string; bucket_id: string; object_name: string; reason: string; attempts: number; last_error: string | null; failed_at: string | null }>
  events: Array<{ id: string; occurred_at: string; action: string; actor_type: string; bytes: number | null; file_id: string | null; details: Record<string, unknown> }>
  runs: Run[]
}

const MODE_HELP: Record<string, string> = {
  off: 'Nothing runs.',
  dry_run: 'Inventory and counts only. No warnings, no quarantine, no deletion.',
  quarantine: 'Sends expiry warnings and quarantines expired files (no access). Nothing is deleted.',
  enforce: 'Also deletes quarantined files after the quarantine period and meeting audio after verified transcription.',
}

function StorageTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'infra', 'storage'], queryFn: () => adminApi<StorageData>('infra/storage') })
  const d = q.data
  const [eventFilter, setEventFilter] = useState('')
  const post = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => adminApi(path, { method: 'POST', body }),
    onSuccess: async () => {
      toast.success('Saved')
      await qc.invalidateQueries({ queryKey: ['admin', 'infra'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  const inv = (d?.inventory?.details ?? {}) as {
    attachments?: Record<string, number>
    audio?: Record<string, number>
    orphans?: Record<string, number>
    queue?: Record<string, number>
    unregistered_objects?: Record<string, number>
    reclaimed_bytes?: number
  }
  const events = useMemo(() => (d?.events ?? []).filter((e) => !eventFilter || e.action.includes(eventFilter)), [d?.events, eventFilter])

  return (
    <div className="space-y-5">
      <Loading q={q} />
      {d ? (
        <>
          <Panel title={`Inventory${d.inventory ? ` · ${ago(d.inventory.collected_at)}` : ''}`}>
            {d.inventory ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InvStat label="Attachments" value={`${inv.attachments?.files ?? 0} files · ${bytes(inv.attachments?.bytes)}`} hint={`${inv.attachments?.expiring_within_7_days ?? 0} expiring within 7 days · ${inv.attachments?.quarantined ?? 0} quarantined · ${inv.attachments?.legal_hold ?? 0} on hold`} />
                <InvStat label="Meeting audio" value={`${inv.audio?.files ?? 0} files · ${bytes(inv.audio?.bytes)}`} hint={`${inv.audio?.transcribed_files ?? 0} transcribed (${bytes(inv.audio?.transcribed_bytes)}) · ${bytes(inv.audio?.deleted_bytes)} already removed`} />
                <InvStat label="Orphans / unregistered" value={`${inv.orphans?.files ?? 0} · ${bytes(inv.orphans?.bytes)}`} hint={`${inv.unregistered_objects?.files ?? 0} objects not yet inventoried`} />
                <InvStat label="Deletion queue" value={`${inv.queue?.pending ?? 0} pending`} hint={`${inv.queue?.failed ?? 0} failed · reclaimed so far ${bytes(inv.reclaimed_bytes)}`} />
              </div>
            ) : (
              <p className="text-sm text-muted">No inventory yet. Use “Collect metrics now”.</p>
            )}
          </Panel>

          <LifecycleSettings settings={d.settings} busy={post.isPending} onSave={(body) => post.mutate({ path: 'infra/lifecycle/settings', body })} />

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Retention policies">
              <Table
                head={['Scope', 'Category', 'Keep', 'Hold', 'Set by']}
                rows={d.policies.map((p) => [
                  p.scope_type === 'platform' ? 'Platform default' : `${p.scope_type}: ${p.scope_name ?? p.scope_id}`,
                  p.category,
                  p.retention_days == null ? 'until removed' : `${p.retention_days} days`,
                  p.legal_hold ? 'Yes' : '—',
                  p.set_by,
                ])}
              />
              <RetentionForm busy={post.isPending} onSave={(body) => post.mutate({ path: 'infra/retention', body })} />
            </Panel>
            <Panel title="Largest storage users">
              <Table
                head={['Scope', 'Category', 'Files', 'Stored', 'In flight']}
                rows={d.topUsage.map((u) => [`${u.scope_type}: ${u.scope_name ?? u.scope_id}`, u.category, u.files_active, bytes(u.bytes_active), bytes(u.bytes_pending)])}
              />
              <QuotaForm busy={post.isPending} onSave={(body) => post.mutate({ path: 'infra/quota', body })} />
              {d.quotas.length ? (
                <Table head={['Quota override', 'Limit']} rows={d.quotas.map((q2) => [`${q2.scope_type}: ${q2.scope_name ?? q2.scope_id}`, bytes(q2.max_bytes)])} />
              ) : null}
            </Panel>
          </div>

          <FileTools busy={post.isPending} onPost={(path, body) => post.mutate({ path, body })} />

          {d.failedDeletions.length ? (
            <Panel title="Deletions that failed permanently">
              <Table head={['Object', 'Reason', 'Attempts', 'Error', 'Failed']} rows={d.failedDeletions.map((f) => [`${f.bucket_id}/${f.object_name}`, f.reason, f.attempts, f.last_error ?? '—', when(f.failed_at)])} />
            </Panel>
          ) : null}

          <Panel
            title="Audit trail"
            action={<Input className="h-8 w-48" placeholder="Filter by action" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} />}
          >
            <Table
              head={['When', 'Action', 'Actor', 'Size', 'Details']}
              rows={events.map((e) => [when(e.occurred_at), e.action, e.actor_type, e.bytes ? bytes(e.bytes) : '—', <span key="d" className="font-mono text-[11px] text-muted">{JSON.stringify(e.details)}</span>])}
            />
          </Panel>
          <Panel title="Lifecycle runs">
            <RunsTable runs={d.runs} />
          </Panel>
        </>
      ) : null}
    </div>
  )
}

function InvStat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border-subtle p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </div>
  )
}

const NUMERIC_SETTINGS: Array<[string, string, 'n' | 'mb']> = [
  ['quarantine_days', 'Quarantine (days)', 'n'],
  ['max_deletions_per_run', 'Max deletions per run', 'n'],
  ['max_bytes_per_run', 'Max data deleted per run (MB)', 'mb'],
  ['circuit_breaker_files', 'Circuit breaker (files due at once)', 'n'],
  ['max_delete_attempts', 'Delete attempts before failing', 'n'],
  ['abandoned_upload_hours', 'Abandoned upload after (hours)', 'n'],
  ['orphan_grace_hours', 'Orphan grace (hours)', 'n'],
  ['attachment_max_bytes', 'Max attachment size (MB)', 'mb'],
  ['default_user_quota_bytes', 'Default personal quota (MB)', 'mb'],
  ['default_workspace_quota_bytes', 'Default workspace quota (MB)', 'mb'],
  ['user_max_retention_days', 'Longest personal retention (days)', 'n'],
  ['workspace_max_retention_days', 'Longest workspace retention (days)', 'n'],
]

function LifecycleSettings({ settings, busy, onSave }: { settings: Settings; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const value = (key: string, kind: 'n' | 'mb') =>
    draft[key] ?? (kind === 'mb' ? String(Math.round(Number(settings[key] ?? 0) / 1024 / 1024)) : String(settings[key] ?? ''))
  const save = () => {
    const body: Record<string, unknown> = {}
    for (const [key, , kind] of NUMERIC_SETTINGS) {
      if (draft[key] === undefined) continue
      const n = Number(draft[key])
      body[key] = kind === 'mb' ? Math.round(n * 1024 * 1024) : n
    }
    onSave(body)
    setDraft({})
  }
  return (
    <Panel title="Lifecycle settings">
      <div className="space-y-4">
        <div>
          <Label>Mode</Label>
          <div className="mt-1 inline-flex rounded-xl border border-border bg-surface-2/60 p-1">
            {(['off', 'dry_run', 'quarantine', 'enforce'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (mode === settings.mode) return
                  if (mode === 'enforce' && !window.confirm('Enforce deletes quarantined files after their quarantine and transcribed meeting audio. Continue?')) return
                  onSave({ mode })
                }}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', settings.mode === mode ? 'bg-surface text-foreground shadow-sm' : 'text-muted')}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{MODE_HELP[String(settings.mode)]}</p>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={Boolean(settings.audio_disposal_enabled)} disabled={busy} onCheckedChange={(v) => onSave({ audio_disposal_enabled: v })} />
            Delete meeting audio after verified transcription
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={Boolean(settings.historical_audio_approved)}
              disabled={busy}
              onCheckedChange={(v) => {
                if (v && !window.confirm('Include recordings of meetings finished before the lifecycle was installed? Only fully transcribed meetings qualify.')) return
                onSave({ historical_audio_approved: v })
              }}
            />
            Include historical audio (before {when(settings.historical_audio_cutoff)})
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {NUMERIC_SETTINGS.map(([key, label, kind]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`s-${key}`} className="text-xs">
                {label}
              </Label>
              <Input id={`s-${key}`} inputMode="numeric" value={value(key, kind)} onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value.replace(/[^0-9.]/g, '') }))} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={busy || !Object.keys(draft).length} onClick={save}>
            Save settings
          </Button>
          {settings.approved_at ? <p className="text-xs text-muted">Last approval {when(settings.approved_at)}</p> : null}
        </div>
      </div>
    </Panel>
  )
}

function RetentionForm({ busy, onSave }: { busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [scopeType, setScopeType] = useState<'platform' | 'workspace' | 'user'>('workspace')
  const [scopeId, setScopeId] = useState('')
  const [days, setDays] = useState('')
  const [hold, setHold] = useState(false)
  const body = (remove = false) => ({
    scope_type: scopeType,
    scope_id: scopeType === 'platform' ? null : scopeId.trim(),
    category: 'task_attachment',
    retention_days: days.trim() === '' ? null : Number(days),
    legal_hold: hold,
    ...(remove ? { remove: true } : {}),
  })
  return (
    <div className="mt-4 space-y-2 border-t border-border-subtle pt-4">
      <p className="text-xs text-muted">Organization overrides lock the workspace’s own setting. Empty days = keep until removed.</p>
      <div className="flex flex-wrap items-end gap-2">
        <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={scopeType} onChange={(e) => setScopeType(e.target.value as typeof scopeType)}>
          <option value="workspace">Workspace</option>
          <option value="user">User</option>
          <option value="platform">Platform default</option>
        </select>
        {scopeType !== 'platform' ? <Input className="h-9 w-72" placeholder={`${scopeType} id`} value={scopeId} onChange={(e) => setScopeId(e.target.value)} /> : null}
        <Input className="h-9 w-28" placeholder="days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))} />
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={hold} onCheckedChange={setHold} /> Legal hold
        </label>
        <Button size="sm" disabled={busy || (scopeType !== 'platform' && !scopeId.trim())} onClick={() => onSave(body())}>
          Save
        </Button>
        {scopeType !== 'platform' ? (
          <Button size="sm" variant="ghost" disabled={busy || !scopeId.trim()} onClick={() => onSave(body(true))}>
            Remove override
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function QuotaForm({ busy, onSave }: { busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [scopeType, setScopeType] = useState<'workspace' | 'user'>('workspace')
  const [scopeId, setScopeId] = useState('')
  const [mb, setMb] = useState('')
  return (
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border-subtle pt-4">
      <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={scopeType} onChange={(e) => setScopeType(e.target.value as typeof scopeType)}>
        <option value="workspace">Workspace</option>
        <option value="user">User</option>
      </select>
      <Input className="h-9 w-72" placeholder={`${scopeType} id`} value={scopeId} onChange={(e) => setScopeId(e.target.value)} />
      <Input className="h-9 w-32" placeholder="MB (empty = default)" value={mb} onChange={(e) => setMb(e.target.value.replace(/[^0-9]/g, ''))} />
      <Button
        size="sm"
        disabled={busy || !scopeId.trim()}
        onClick={() => onSave({ scope_type: scopeType, scope_id: scopeId.trim(), max_bytes: mb ? Number(mb) * 1024 * 1024 : null })}
      >
        Set quota
      </Button>
    </div>
  )
}

type FileRow = { id: string; category: string; scope: string; original_filename: string | null; size_bytes: number; status: string; legal_hold: boolean; expires_at: string | null; workspace_name: string | null; owner_email: string | null }

function FileTools({ busy, onPost }: { busy: boolean; onPost: (path: string, body: unknown) => void }) {
  const [term, setTerm] = useState('')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['admin', 'infra', 'files', submitted],
    queryFn: () => adminApi<{ files: FileRow[] }>(`infra/files?q=${encodeURIComponent(submitted ?? '')}`),
    enabled: submitted !== null,
  })
  const reasonFor = (action: string) => window.prompt(`Reason for ${action} (kept in the audit log)`)?.trim()
  return (
    <Panel title="Files: legal holds and extensions">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(term)
        }}
      >
        <Input className="h-9 max-w-md" placeholder="File name, workspace, owner email or file id" value={term} onChange={(e) => setTerm(e.target.value)} />
        <Button size="sm" type="submit">
          Search
        </Button>
      </form>
      <Loading q={q} />
      {q.data ? (
        <div className="mt-3">
          <Table
            head={['File', 'Where', 'Size', 'Status', 'Expires', '']}
            rows={q.data.files.map((f) => [
              f.original_filename ?? f.id,
              f.workspace_name ?? f.owner_email ?? f.scope,
              bytes(f.size_bytes),
              `${f.status}${f.legal_hold ? ' · hold' : ''}`,
              f.expires_at ? when(f.expires_at) : '—',
              <div key="a" className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    const reason = reasonFor(f.legal_hold ? 'releasing the hold' : 'the legal hold')
                    if (reason) onPost('infra/files/hold', { file_id: f.id, legal_hold: !f.legal_hold, reason })
                  }}
                >
                  {f.legal_hold ? 'Release hold' : 'Legal hold'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    const days = Number(window.prompt('Keep for how many more days?', '90'))
                    const reason = days > 0 ? reasonFor('the extension') : null
                    if (days > 0 && reason) onPost('infra/files/extend', { file_id: f.id, days, reason })
                  }}
                >
                  Extend
                </Button>
              </div>,
            ])}
          />
        </div>
      ) : null}
    </Panel>
  )
}

// ── Database ─────────────────────────────────────────────────────────────────

function History({ metric, unit, title }: { metric: string; unit: string; title: string }) {
  const q = useQuery({
    queryKey: ['admin', 'infra', 'history', metric],
    queryFn: () => adminApi<{ points: Array<{ day: string; value: string | null }> }>(`infra/history?metric=${metric}&days=30`),
  })
  const points = (q.data?.points ?? []).map((p) => ({ day: p.day, value: Number(p.value ?? 0) }))
  return (
    <Panel title={title}>
      <Loading q={q} />
      {points.length ? (
        <Bars data={points} value="value" label={(r) => `${String(r.day)}: ${formatValue(Number(r.value), unit)}`} />
      ) : (
        <p className="text-sm text-muted">History builds up as hourly snapshots are collected.</p>
      )}
    </Panel>
  )
}

function DatabaseTab() {
  const q = useOverview()
  const m = q.data?.metrics
  const tables = (pick(m, 'supabase.db_largest_tables')?.details ?? []) as Array<{ name: string; bytes: number; rows: number }>
  return (
    <div className="space-y-5">
      <Loading q={q} />
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard title="Database size" metric={pick(m, 'supabase.db_size_bytes')} limit={limitOf(q.data?.limits, 'supabase.db_size')} />
        <MetricCard
          title="Connections"
          metric={pick(m, 'supabase.db_connections')}
          limit={Number((pick(m, 'supabase.db_connections')?.details as { max_connections?: number } | undefined)?.max_connections ?? 0) || null}
        />
        <MetricCard title="Backups" unit="days" metric={undefined} note="Free plan: no automatic backups. Pro keeps 7 days of daily backups." />
      </div>
      <History metric="supabase.db_size_bytes" unit="bytes" title="Database size (30 days)" />
      <Panel title="Largest tables">
        <Table head={['Table', 'Size (with indexes)', 'Rows (estimate)']} rows={tables.map((t) => [t.name, bytes(t.bytes), Number(t.rows).toLocaleString()])} />
      </Panel>
    </div>
  )
}

// ── Services ─────────────────────────────────────────────────────────────────

function ServicesTab() {
  const qc = useQueryClient()
  const q = useOverview()
  const m = q.data?.metrics
  const l = q.data?.limits
  const fns = (pick(m, 'netlify.function_breakdown')?.details ?? []) as Array<{ fn: string; invocations: number; errors: number; avgMs: number; maxMs: number }>
  const buckets = (pick(m, 'supabase.storage_bytes')?.details ?? []) as Array<{ bucket: string; files: number; bytes: number }>
  const openrouter = pick(m, 'openrouter.key_usage_usd')
  const orDetails = (openrouter?.details ?? {}) as Record<string, number | boolean | null>
  const netlifyPeriod = (pick(m, 'netlify.function_invocations')?.details ?? {}) as { period_start?: string; period_end?: string; provider_updated_at?: string }
  const [manualMetric, setManualMetric] = useState('supabase.egress_bytes')
  const [manualValue, setManualValue] = useState('')
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({})
  const post = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => adminApi(path, { method: 'POST', body }),
    onSuccess: async () => {
      toast.success('Saved')
      await qc.invalidateQueries({ queryKey: ['admin', 'infra'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  return (
    <div className="space-y-5">
      <Loading q={q} />
      <Panel title="Netlify">
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard title="Function invocations" metric={pick(m, 'netlify.function_invocations')} limit={limitOf(l, 'netlify.function_invocations')} />
          <MetricCard title="Function runtime" metric={pick(m, 'netlify.function_runtime_seconds')} limit={limitOf(l, 'netlify.function_runtime')} />
          <MetricCard title="Bandwidth" metric={pick(m, 'netlify.bandwidth_bytes')} limit={limitOf(l, 'netlify.bandwidth')} />
        </div>
        <p className="mt-2 text-xs text-muted">
          Billing period {netlifyPeriod.period_start ? when(netlifyPeriod.period_start) : '—'} → {netlifyPeriod.period_end ? when(netlifyPeriod.period_end) : '—'} · provider updated{' '}
          {ago(netlifyPeriod.provider_updated_at)}
        </p>
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted">Per function this month (Hilm counters; started when instrumentation was deployed)</p>
          <Table head={['Function', 'Invocations', 'Errors', 'Avg', 'Max']} rows={fns.map((f) => [f.fn, f.invocations.toLocaleString(), f.errors, `${f.avgMs} ms`, `${f.maxMs} ms`])} />
        </div>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Supabase Storage by bucket">
          <Table head={['Bucket', 'Objects', 'Size']} rows={buckets.map((b) => [b.bucket, b.files, bytes(b.bytes)])} />
        </Panel>
        <Panel title="OpenRouter">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard title="Key usage (lifetime)" metric={openrouter} />
            <div className="rounded-2xl border border-border-subtle p-4 text-sm">
              <p>Today: {usd(orDetails.usage_daily)}</p>
              <p>This month: {usd(orDetails.usage_monthly)}</p>
              <p>Key limit: {orDetails.limit == null ? 'none' : usd(orDetails.limit)}</p>
              <p>Remaining: {orDetails.limit_remaining == null ? '—' : usd(orDetails.limit_remaining)}</p>
            </div>
          </div>
        </Panel>
        <Panel title="Soniox (transcription)">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard title="Audio transcribed this month" metric={pick(m, 'soniox.audio_hours_month')} />
            <MetricCard title="Cost this month" metric={pick(m, 'soniox.cost_month_usd')} note="$0.10 per audio hour, no free allowance. Soniox has no usage API." />
          </div>
        </Panel>
        <Panel title="Resend (email)">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard title="Sent today" metric={pick(m, 'email.sent_today')} limit={limitOf(l, 'resend.daily_emails')} />
            <MetricCard title="Sent this month" metric={pick(m, 'email.sent_month')} limit={limitOf(l, 'resend.monthly_emails')} note={`${formatValue(pick(m, 'email.failed_7d')?.value, 'n')} failed in 7 days`} />
          </div>
        </Panel>
      </div>
      <Panel title="Values without an API">
        <p className="mb-3 text-xs text-muted">Copy the figure from the provider dashboard. It is stored as a manual value with your account and the time.</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={manualMetric} onChange={(e) => setManualMetric(e.target.value)}>
            <option value="supabase.egress_bytes">Supabase egress (GB)</option>
            <option value="resend.sent_month_provider">Resend emails this month</option>
            <option value="soniox.balance_usd">Soniox balance (USD)</option>
          </select>
          <Input className="h-9 w-40" inputMode="decimal" value={manualValue} onChange={(e) => setManualValue(e.target.value.replace(/[^0-9.]/g, ''))} />
          <Button
            size="sm"
            disabled={post.isPending || !manualValue}
            onClick={() => {
              const n = Number(manualValue)
              post.mutate({ path: 'infra/manual-metric', body: { metric: manualMetric, value: manualMetric === 'supabase.egress_bytes' ? n * 1024 ** 3 : n } })
              setManualValue('')
            }}
          >
            Record
          </Button>
        </div>
      </Panel>
      <Panel title="Plan limits">
        <Table
          head={['Limit', 'Value', 'Plan', 'Source', 'Verified', '']}
          rows={(l ?? []).map((row) => [
            row.label,
            <Input
              key="v"
              className="h-8 w-40"
              value={limitDraft[row.key] ?? (row.limit_value == null ? '' : String(row.limit_value))}
              onChange={(e) => setLimitDraft((p) => ({ ...p, [row.key]: e.target.value.replace(/[^0-9.]/g, '') }))}
            />,
            row.plan ?? '—',
            <span key="s" className="text-xs text-muted">
              {row.source} <QualityBadge quality={row.quality} />
            </span>,
            row.verified_at ? when(row.verified_at) : '—',
            limitDraft[row.key] !== undefined ? (
              <Button
                key="b"
                size="sm"
                variant="ghost"
                onClick={() => {
                  post.mutate({ path: 'infra/limits', body: { key: row.key, limit_value: limitDraft[row.key] === '' ? null : Number(limitDraft[row.key]) } })
                  setLimitDraft((p) => {
                    const next = { ...p }
                    delete next[row.key]
                    return next
                  })
                }}
              >
                Save
              </Button>
            ) : (
              ''
            ),
          ])}
        />
      </Panel>
    </div>
  )
}

// ── Forecasting ──────────────────────────────────────────────────────────────

type ForecastRow = {
  orgs: number
  profile: 'low' | 'medium' | 'high'
  members: number
  storageBytes: number
  storageBytesWithoutLifecycle: number
  dbBytes: number
  egressBytesMonth: number
  invocationsMonth: number
  bandwidthBytesMonth: number
  aiUsdMonth: number
  sonioxUsdMonth: number
  emailsMonth: number
  emailsPeakDay: number
  exceeds: string[]
  recommendations: string[]
}
type ForecastData = {
  inputs: Record<string, number | null>
  limits: Record<string, number>
  rows: ForecastRow[]
  current: {
    organizations: number | null
    users: number | null
    storageBytes: number | null
    storageDailyGrowth: number | null
    storageDaysToLimit: number | null
    dbBytes: number | null
    dbDailyGrowth: number | null
    dbDaysToLimit: number | null
    trendDays: number
  }
}

const EXCEED_LABEL: Record<string, string> = {
  storageBytes: 'Storage',
  dbBytes: 'Database',
  egressBytes: 'Egress',
  invocations: 'Invocations',
  bandwidthBytes: 'Bandwidth',
  emailsMonth: 'Emails/month',
  emailsDay: 'Emails/day',
}

function ForecastTab() {
  const q = useQuery({ queryKey: ['admin', 'infra', 'forecast'], queryFn: () => adminApi<ForecastData>('infra/forecast') })
  const [profile, setProfile] = useState<'all' | 'low' | 'medium' | 'high'>('all')
  const d = q.data
  const rows = (d?.rows ?? []).filter((r) => profile === 'all' || r.profile === profile)
  const cell = (value: number, limit: number | undefined, render: (v: number) => string) => (
    <span className={cn(limit && value > limit ? 'text-red-300' : limit && value > limit * 0.7 ? 'text-amber-300' : '')}>{render(value)}</span>
  )
  return (
    <div className="space-y-5">
      <Loading q={q} />
      {d ? (
        <>
          <Panel title="Today (measured)">
            <div className="grid gap-3 sm:grid-cols-4">
              <InvStat label="Organizations" value={d.current.organizations ?? '—'} hint={`${d.current.users ?? '—'} users`} />
              <InvStat
                label="Storage"
                value={bytes(d.current.storageBytes)}
                hint={d.current.storageDailyGrowth != null ? `${bytes(d.current.storageDailyGrowth)}/day · ${d.current.storageDaysToLimit ?? '∞'} days to the limit` : 'Trend needs a day of snapshots'}
              />
              <InvStat
                label="Database"
                value={bytes(d.current.dbBytes)}
                hint={d.current.dbDailyGrowth != null ? `${bytes(d.current.dbDailyGrowth)}/day · ${d.current.dbDaysToLimit ?? '∞'} days to the limit` : 'Trend needs a day of snapshots'}
              />
              <InvStat label="Measured audio size" value={d.inputs.audioBytesPerHour ? `${bytes(d.inputs.audioBytesPerHour)}/hour` : 'not measured'} />
            </div>
          </Panel>
          <Panel
            title="Forecast (estimates, per month unless noted)"
            action={
              <select className="h-8 rounded-lg border border-border bg-surface px-2 text-xs" value={profile} onChange={(e) => setProfile(e.target.value as typeof profile)}>
                <option value="all">All usage levels</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            }
          >
            <Table
              head={['Orgs', 'Usage', 'Members', 'Storage', 'Without lifecycle', 'DB (12 mo)', 'Egress', 'Invocations', 'Bandwidth', 'AI', 'Soniox', 'Emails (peak/day)', 'Over free plan']}
              rows={rows.map((r) => [
                r.orgs,
                r.profile,
                r.members,
                cell(r.storageBytes, d.limits.storageBytes, bytes),
                <span key="w" className="text-muted">{bytes(r.storageBytesWithoutLifecycle)}</span>,
                cell(r.dbBytes, d.limits.dbBytes, bytes),
                cell(r.egressBytesMonth, d.limits.egressBytes, bytes),
                cell(r.invocationsMonth, d.limits.invocations, (v) => Math.round(v).toLocaleString()),
                cell(r.bandwidthBytesMonth, d.limits.bandwidthBytes, bytes),
                usd(r.aiUsdMonth),
                usd(r.sonioxUsdMonth),
                cell(r.emailsPeakDay, d.limits.emailsDay, (v) => `${Math.round(r.emailsMonth).toLocaleString()} (${v})`),
                r.exceeds.length ? (
                  <span key="e" className="text-xs" title={r.recommendations.join('\n')}>
                    {r.exceeds.map((e) => EXCEED_LABEL[e] ?? e).join(', ')}
                  </span>
                ) : (
                  <span key="e" className="text-xs text-emerald-300">fits</span>
                ),
              ])}
            />
            <div className="mt-4 space-y-1 text-xs text-muted">
              <p>Assumptions per organization and member are listed in the code (ops/forecast.ts) and are estimates. Measured inputs replace them where available (audio bytes per hour, current database size).</p>
              <p>Storage assumes attachments kept {d.inputs.attachmentRetentionDays} days + {d.inputs.quarantineDays} days quarantine and audio deleted after transcription. “Without lifecycle” keeps everything for 12 months.</p>
              <p>Upgrade suggestions are recommendations only. Nothing is purchased automatically.</p>
            </div>
          </Panel>
          <Panel title="Recommendations">
            {[...new Set(d.rows.flatMap((r) => r.recommendations))].map((text) => (
              <p key={text} className="text-sm">
                • {text}{' '}
                <span className="text-xs text-muted">
                  (first needed at {d.rows.filter((r) => r.recommendations.includes(text)).sort((a, b) => a.orgs - b.orgs)[0]?.orgs} organizations,{' '}
                  {d.rows.filter((r) => r.recommendations.includes(text)).sort((a, b) => a.orgs - b.orgs)[0]?.profile} usage)
                </span>
              </p>
            ))}
          </Panel>
        </>
      ) : null}
    </div>
  )
}

// ── Operations ───────────────────────────────────────────────────────────────

type Rule = { key: string; metric: string; comparison: string; warn_value: string | null; crit_value: string | null; limit_key: string | null; cooldown_hours: number; notify: boolean; enabled: boolean; description: string }
type OperationsData = {
  runs: Run[]
  alerts: Alert[]
  rules: Rule[]
  collectors: Collector[]
  queue: Array<{ status: string; n: number; oldest: string | null }>
  functions: Array<{ day: string; fn: string; invocations: number; errors: number; total_ms: number; max_ms: number }>
}

function OperationsTab() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'infra', 'operations'], queryFn: () => adminApi<OperationsData>('infra/operations') })
  const [alertFilter, setAlertFilter] = useState<'open' | 'all'>('open')
  const [draft, setDraft] = useState<Record<string, { warn?: string; crit?: string }>>({})
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminApi('infra/alert-rules', { method: 'POST', body }),
    onSuccess: async () => {
      toast.success('Rule saved')
      await qc.invalidateQueries({ queryKey: ['admin', 'infra'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  const d = q.data
  const alerts = (d?.alerts ?? []).filter((a) => alertFilter === 'all' || !a.resolved_at)
  return (
    <div className="space-y-5">
      <Loading q={q} />
      {d ? (
        <>
          <Panel
            title="Alerts"
            action={
              <select className="h-8 rounded-lg border border-border bg-surface px-2 text-xs" value={alertFilter} onChange={(e) => setAlertFilter(e.target.value as typeof alertFilter)}>
                <option value="open">Open</option>
                <option value="all">All (history)</option>
              </select>
            }
          >
            <AlertList alerts={alerts} />
          </Panel>
          <Panel title="Alert rules">
            <Table
              head={['Rule', 'Warning', 'Critical', 'Cooldown', 'Email', 'On', '']}
              rows={d.rules.map((r) => {
                const local = draft[r.key] ?? {}
                return [
                  <span key="n">
                    {r.description}
                    <br />
                    <span className="text-[11px] text-muted">
                      {r.metric}
                      {r.limit_key ? ` · % of ${r.limit_key}` : ''}
                    </span>
                  </span>,
                  <Input key="w" className="h-8 w-20" value={local.warn ?? r.warn_value ?? ''} onChange={(e) => setDraft((p) => ({ ...p, [r.key]: { ...p[r.key], warn: e.target.value } }))} />,
                  <Input key="c" className="h-8 w-20" value={local.crit ?? r.crit_value ?? ''} onChange={(e) => setDraft((p) => ({ ...p, [r.key]: { ...p[r.key], crit: e.target.value } }))} />,
                  `${r.cooldown_hours} h`,
                  <Switch key="m" checked={r.notify} onCheckedChange={(v) => save.mutate({ key: r.key, notify: v })} />,
                  <Switch key="e" checked={r.enabled} onCheckedChange={(v) => save.mutate({ key: r.key, enabled: v })} />,
                  draft[r.key] ? (
                    <Button
                      key="s"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const body: Record<string, unknown> = { key: r.key }
                        if (local.warn !== undefined) body.warn_value = local.warn === '' ? null : Number(local.warn)
                        if (local.crit !== undefined) body.crit_value = local.crit === '' ? null : Number(local.crit)
                        save.mutate(body)
                        setDraft((p) => {
                          const next = { ...p }
                          delete next[r.key]
                          return next
                        })
                      }}
                    >
                      Save
                    </Button>
                  ) : (
                    ''
                  ),
                ]
              })}
            />
          </Panel>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Scheduled jobs">
              <Table head={['Job', 'Every', 'Last attempt', 'Last success', 'Error']} rows={d.collectors.map((c) => [c.collector, `${c.interval_minutes} min`, ago(c.last_attempt_at), ago(c.last_success_at), c.last_error ?? '—'])} />
            </Panel>
            <Panel title="Deletion queue">
              <Table head={['Status', 'Items', 'Oldest request']} rows={d.queue.map((r) => [r.status, r.n, when(r.oldest)])} />
            </Panel>
          </div>
          <Panel title="Lifecycle runs">
            <RunsTable runs={d.runs} />
          </Panel>
          <Panel title="Function calls (14 days)">
            <Table head={['Day', 'Function', 'Calls', 'Errors', 'Avg', 'Max']} rows={d.functions.map((f) => [f.day, f.fn, f.invocations, f.errors, `${f.invocations ? Math.round(f.total_ms / f.invocations) : 0} ms`, `${f.max_ms} ms`])} />
          </Panel>
        </>
      ) : null}
    </div>
  )
}
