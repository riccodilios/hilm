import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminApi, usd, when } from '@/admin/client'
import { Loading, Panel, Stat, Table, errorText } from '@/admin/pages'

type Plan = {
  id: string
  display_name: string
  scope: 'personal' | 'workspace'
  price_sar_monthly: string | number
  price_sar_yearly: string | number | null
  max_workspaces: number | null
  max_projects_per_workspace: number | null
  storage_quota_bytes: string | number | null
  requests_per_minute: number
  requests_per_day: number
  requests_per_month: number
  tokens_per_day: string | number
  tokens_per_month: string | number
  cost_usd_per_day: string | number
  cost_usd_per_month: string | number
  max_concurrent: number
  member_requests_per_day: number | null
  meeting_minutes_per_month: number
  meeting_max_minutes: number
  enabled: boolean
  updated_at: string
}

type ScopeUsage = { requests: number; meeting_runs: number; tokens: number | string; cost_usd: number | string; users: number; workspaces: number }

type Overview = {
  period: string
  plans: Plan[]
  personal: { accounts: Array<{ plan_id: string; accounts: number }>; usage: ScopeUsage }
  workspace: { subscriptions: Array<{ plan_id: string; status: string; subscriptions: number; workspaces: number }>; usage: ScopeUsage }
  storage: Array<{ scope: string; files: number; bytes: number | string }>
  pendingRequests: Array<{ id: string; plan_id: string; status: string; note: string | null; created_at: string; email: string | null; user_id: string; workspace_id: string | null }>
}

type SubscriptionRow = {
  id: string
  plan_id: string
  status: string
  provider: string
  notes: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  owner_email: string | null
  workspaces: Array<{
    id: string
    name: string
    members: number
    projects: number
    ai_requests: number
    ai_tokens: number | string
    ai_cost_usd: number | string
    storage_bytes: number | string
    effective_status: string
  }>
}

const bytes = (value: unknown) => {
  const n = Number(value ?? 0)
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}
const num = (value: unknown) => Number(value ?? 0).toLocaleString()
const thisMonth = () => new Date().toISOString().slice(0, 7)

const EDITABLE: Array<[keyof Plan, string]> = [
  ['price_sar_monthly', 'Price SAR / month'],
  ['price_sar_yearly', 'Price SAR / year (empty = not offered)'],
  ['max_workspaces', 'Workspaces'],
  ['max_projects_per_workspace', 'Projects per workspace'],
  ['storage_quota_bytes', 'Storage (bytes)'],
  ['requests_per_minute', 'Requests / minute (per member)'],
  ['requests_per_day', 'Requests / day'],
  ['requests_per_month', 'Requests / month'],
  ['member_requests_per_day', 'Requests / day per member'],
  ['tokens_per_day', 'Tokens / day'],
  ['tokens_per_month', 'Tokens / month'],
  ['cost_usd_per_day', 'Spend cap USD / day'],
  ['cost_usd_per_month', 'Spend cap USD / month'],
  ['max_concurrent', 'Concurrent requests'],
  ['meeting_minutes_per_month', 'Meeting minutes / month'],
  ['meeting_max_minutes', 'Max minutes per meeting'],
]
const NULLABLE = new Set<keyof Plan>(['price_sar_yearly', 'max_workspaces', 'max_projects_per_workspace', 'storage_quota_bytes', 'member_requests_per_day'])
const DECIMAL = new Set<keyof Plan>(['price_sar_monthly', 'price_sar_yearly', 'cost_usd_per_day', 'cost_usd_per_month'])

function PlanEditor({ plan }: { plan: Plan }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, number | null> = {}
      for (const [key, raw] of Object.entries(draft)) {
        const value = raw.trim()
        body[key] = value === '' && NULLABLE.has(key as keyof Plan) ? null : DECIMAL.has(key as keyof Plan) ? Number(value) : Math.round(Number(value))
      }
      return adminApi(`billing/plans/${plan.id}`, { method: 'POST', body })
    },
    onSuccess: async () => {
      toast.success(`${plan.display_name} saved. Existing usage records are unchanged.`)
      setDraft({})
      await qc.invalidateQueries({ queryKey: ['admin', 'billing'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  const fields = EDITABLE.filter(([key]) =>
    plan.scope === 'workspace' ? true : !['max_workspaces', 'max_projects_per_workspace', 'member_requests_per_day', 'storage_quota_bytes'].includes(key),
  )
  return (
    <Panel
      title={`${plan.display_name} · ${plan.scope === 'personal' ? 'Personal OS' : 'Workspace OS'}`}
      action={
        <Button size="sm" disabled={!Object.keys(draft).length || save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label className="text-xs text-muted">{label}</Label>
            <Input
              inputMode="decimal"
              value={draft[key] ?? (plan[key] == null ? '' : String(plan[key]))}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.replace(/[^0-9.]/g, '') }))}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Last changed {when(plan.updated_at)}. Changes apply from now on and are recorded in the audit log.</p>
    </Panel>
  )
}

function SubscriptionActions({ row }: { row: SubscriptionRow }) {
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => adminApi(`billing/subscriptions/${row.id}${path}`, { method: 'POST', body }),
    onSuccess: async () => {
      toast.success('Subscription updated')
      await qc.invalidateQueries({ queryKey: ['admin', 'billing'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  return (
    <div className="flex flex-wrap gap-1.5">
      <select
        aria-label="Plan"
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        value={row.plan_id}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ path: '', body: { planId: e.target.value } })}
      >
        <option value="team">Team</option>
        <option value="team_pro">Team Pro</option>
      </select>
      <select
        aria-label="Status"
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        value={row.status}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ path: '', body: { status: e.target.value } })}
      >
        {['active', 'trialing', 'comped', 'past_due', 'canceled', 'expired'].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const value = window.prompt('Period end (YYYY-MM-DD, empty = open-ended)', row.current_period_end?.slice(0, 10) ?? '')
          if (value === null) return
          update.mutate({ path: '', body: { periodEnd: value.trim() ? new Date(`${value.trim()}T23:59:59Z`).toISOString() : null } })
        }}
      >
        Period end
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const email = window.prompt('New billing owner email')
          if (email) update.mutate({ path: '/owner', body: { email } })
        }}
      >
        Billing owner
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const workspaceId = window.prompt('Workspace id to attach')
          if (workspaceId) update.mutate({ path: '/attach', body: { workspaceId: workspaceId.trim() } })
        }}
      >
        Attach workspace
      </Button>
    </div>
  )
}

export function BillingPage() {
  const qc = useQueryClient()
  const [period, setPeriod] = useState(thisMonth())
  const [scope, setScope] = useState<'all' | 'personal' | 'workspace'>('all')
  const [plan, setPlan] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [userId, setUserId] = useState('')
  const [lookup, setLookup] = useState('')
  const [form, setForm] = useState({ ownerEmail: '', planId: 'team', status: 'active', periodEnd: '', notes: '', requestId: '' })

  const overview = useQuery({ queryKey: ['admin', 'billing', 'overview', period], queryFn: () => adminApi<Overview>(`billing/overview?period=${period}`) })
  const subs = useQuery({
    queryKey: ['admin', 'billing', 'subs', period, plan, query],
    queryFn: () =>
      adminApi<{ subscriptions: SubscriptionRow[] }>(`billing/subscriptions?period=${period}&plan=${encodeURIComponent(plan)}&q=${encodeURIComponent(query)}`),
    enabled: scope !== 'personal',
  })
  const usage = useQuery({
    queryKey: ['admin', 'billing', 'user', lookup, period],
    queryFn: () => adminApi<{ personal: Record<string, unknown> | null; workspaceContributions: Array<Record<string, unknown>> }>(`billing/users/${lookup}/usage?period=${period}`),
    enabled: /^[0-9a-f-]{36}$/i.test(lookup),
  })

  const create = useMutation({
    mutationFn: () =>
      adminApi<{ id: string }>('billing/subscriptions', {
        method: 'POST',
        body: {
          ownerEmail: form.ownerEmail.trim(),
          planId: form.planId,
          status: form.status,
          periodEnd: form.periodEnd ? new Date(`${form.periodEnd}T23:59:59Z`).toISOString() : null,
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
          ...(form.requestId ? { requestId: form.requestId } : {}),
        },
      }),
    onSuccess: async () => {
      toast.success('Workspace subscription created')
      setForm({ ownerEmail: '', planId: 'team', status: 'active', periodEnd: '', notes: '', requestId: '' })
      await qc.invalidateQueries({ queryKey: ['admin', 'billing'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  const handleRequest = useMutation({
    mutationFn: async ({ id, status, userId: target, planId }: { id: string; status: 'approved' | 'declined'; userId: string; planId: string }) => {
      if (status === 'approved' && planId === 'pro') await adminApi(`users/${target}/tier`, { method: 'POST', body: { tier: 'pro' } })
      return adminApi(`billing/requests/${id}`, { method: 'POST', body: { status } })
    },
    onSuccess: async () => {
      toast.success('Request handled')
      await qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })

  const d = overview.data
  const showPersonal = scope !== 'workspace'
  const showWorkspace = scope !== 'personal'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="period" className="text-xs text-muted">
            Billing period
          </Label>
          <Input id="period" type="month" value={period} onChange={(e) => setPeriod(e.target.value || thisMonth())} className="w-40" />
        </div>
        <div className="inline-flex rounded-xl border border-border bg-surface-2/60 p-1">
          {(['all', 'personal', 'workspace'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${scope === s ? 'bg-surface text-foreground shadow-sm' : 'text-muted'}`}
            >
              {s === 'all' ? 'Both (shown separately)' : s === 'personal' ? 'Personal OS' : 'Workspace OS'}
            </button>
          ))}
        </div>
      </div>
      <Loading q={overview} />

      {d ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {showPersonal ? (
            <Panel title={`Personal OS · ${d.period}`}>
              <div className="grid gap-3 sm:grid-cols-2">
                {d.personal.accounts.map((a) => (
                  <Stat key={a.plan_id} label={`${a.plan_id === 'pro' ? 'Pro (30 SAR)' : a.plan_id === 'free' ? 'Free' : a.plan_id} accounts`} value={a.accounts} />
                ))}
                <Stat label="Personal AI spend" value={usd(d.personal.usage.cost_usd)} hint={`${d.personal.usage.requests} requests · ${num(d.personal.usage.tokens)} tokens`} />
                <Stat
                  label="Personal storage"
                  value={bytes(d.storage.find((s) => s.scope === 'personal')?.bytes)}
                  hint={`${d.storage.find((s) => s.scope === 'personal')?.files ?? 0} files`}
                />
              </div>
            </Panel>
          ) : null}
          {showWorkspace ? (
            <Panel title={`Workspace OS · ${d.period}`}>
              <div className="grid gap-3 sm:grid-cols-2">
                {d.workspace.subscriptions.map((s) => (
                  <Stat
                    key={`${s.plan_id}-${s.status}`}
                    label={`${s.plan_id === 'team_pro' ? 'Team Pro' : 'Team'} · ${s.status}`}
                    value={s.subscriptions}
                    hint={`${s.workspaces} workspaces`}
                  />
                ))}
                <Stat label="Workspace AI spend" value={usd(d.workspace.usage.cost_usd)} hint={`${d.workspace.usage.requests} requests · ${num(d.workspace.usage.tokens)} tokens`} />
                <Stat
                  label="Workspace storage"
                  value={bytes(d.storage.find((s) => s.scope === 'workspace')?.bytes)}
                  hint={`${d.storage.find((s) => s.scope === 'workspace')?.files ?? 0} files`}
                />
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {d?.pendingRequests.length ? (
        <Panel title="Upgrade requests">
          <Table
            head={['Account', 'Plan', 'Note', 'Requested', '']}
            rows={d.pendingRequests.map((r) => [
              r.email ?? r.user_id,
              r.plan_id === 'team_pro' ? 'Team Pro' : r.plan_id === 'team' ? 'Team' : 'Personal Pro',
              r.note ?? '—',
              when(r.created_at),
              <div key="a" className="flex gap-1.5">
                {r.plan_id === 'pro' ? (
                  <Button size="sm" variant="secondary" onClick={() => handleRequest.mutate({ id: r.id, status: 'approved', userId: r.user_id, planId: r.plan_id })}>
                    Grant Pro
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setForm((f) => ({ ...f, ownerEmail: r.email ?? '', planId: r.plan_id, requestId: r.id }))}>
                    Set up subscription
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => handleRequest.mutate({ id: r.id, status: 'declined', userId: r.user_id, planId: r.plan_id })}>
                  Decline
                </Button>
              </div>,
            ])}
          />
        </Panel>
      ) : null}

      {showWorkspace ? (
        <>
          <Panel title="Grant a workspace subscription (manual billing)">
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
              onSubmit={(e) => {
                e.preventDefault()
                create.mutate()
              }}
            >
              <Input placeholder="Billing owner email" value={form.ownerEmail} onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))} className="lg:col-span-2" />
              <select className="h-10 rounded-md border border-border bg-surface px-2 text-sm" value={form.planId} onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}>
                <option value="team">Team · 250 SAR</option>
                <option value="team_pro">Team Pro · 400 SAR</option>
              </select>
              <select className="h-10 rounded-md border border-border bg-surface px-2 text-sm" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="active">active</option>
                <option value="trialing">trialing</option>
                <option value="comped">comped</option>
              </select>
              <Input type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} aria-label="Period end" />
              <Button type="submit" disabled={create.isPending || !form.ownerEmail.trim()}>
                Create
              </Button>
              <Input placeholder="Notes (invoice number, agreement…)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="sm:col-span-2 lg:col-span-6" />
            </form>
          </Panel>

          <Panel
            title="Workspace subscriptions"
            action={
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  setQuery(search)
                }}
              >
                <select className="h-8 rounded-md border border-border bg-surface px-2 text-xs" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan filter">
                  <option value="">All plans</option>
                  <option value="team">Team</option>
                  <option value="team_pro">Team Pro</option>
                </select>
                <Input placeholder="Owner email or workspace" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-56" />
              </form>
            }
          >
            <Loading q={subs} />
            {subs.data ? (
              <Table
                head={['Owner', 'Plan / status', 'Workspaces (members · projects · AI · storage)', 'Period end', 'Notes', '']}
                rows={subs.data.subscriptions.map((s) => [
                  s.owner_email ?? '—',
                  `${s.plan_id === 'team_pro' ? 'Team Pro' : 'Team'} · ${s.status}${s.cancel_at_period_end ? ' (cancels)' : ''}`,
                  <div key="w" className="space-y-1">
                    {s.workspaces.length ? (
                      s.workspaces.map((w) => (
                        <p key={w.id} className="text-xs">
                          <span className="font-medium">{w.name}</span> · {w.members} members · {w.projects} projects · {w.ai_requests} req · {num(w.ai_tokens)} tok ·{' '}
                          {usd(w.ai_cost_usd)} · {bytes(w.storage_bytes)} · <span className="text-muted">{w.effective_status}</span>
                        </p>
                      ))
                    ) : (
                      <p className="text-xs text-muted">No workspace yet</p>
                    )}
                  </div>,
                  s.current_period_end ? when(s.current_period_end) : 'open-ended',
                  <span key="n" className="text-xs text-muted">{s.notes ?? '—'}</span>,
                  <SubscriptionActions key="x" row={s} />,
                ])}
              />
            ) : null}
          </Panel>
        </>
      ) : null}

      <Panel title="One user's usage (personal and per workspace, never merged)">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setLookup(userId.trim())
          }}
        >
          <Input placeholder="User id" value={userId} onChange={(e) => setUserId(e.target.value)} className="max-w-sm" />
          <Button type="submit" variant="secondary">
            Look up
          </Button>
        </form>
        {usage.data ? (
          <div className="mt-4 space-y-3 text-sm">
            <p>
              Personal OS ({String(usage.data.personal?.plan_id ?? '—')}): {String(usage.data.personal?.requests ?? 0)} requests · {num(usage.data.personal?.tokens)} tokens ·{' '}
              {usd(usage.data.personal?.cost_usd)}
            </p>
            {usage.data.workspaceContributions.map((w) => (
              <p key={String(w.workspace_id)} className="text-muted">
                Workspace “{String(w.name ?? w.workspace_id)}” (charged to the workspace): {String(w.requests)} requests · {num(w.tokens)} tokens · {usd(w.cost_usd)}
              </p>
            ))}
          </div>
        ) : null}
      </Panel>

      {d ? (
        <div className="space-y-5">
          <h2 className="text-sm font-medium">Plan configuration</h2>
          {d.plans
            .filter((p) => ['free', 'pro', 'team', 'team_pro'].includes(p.id))
            .filter((p) => scope === 'all' || p.scope === scope)
            .map((p) => (
              <PlanEditor key={p.id} plan={p} />
            ))}
        </div>
      ) : null}
    </div>
  )
}
