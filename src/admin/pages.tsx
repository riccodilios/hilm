import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Bold, Heading1, Heading2, ImagePlus, Link2, X } from 'lucide-react'
import { AdminApiError, adminApi, uploadEmailImage, usd, when } from '@/admin/client'

const errorText = (e: unknown) => {
  if (!(e instanceof AdminApiError)) return 'Request failed'
  if (e.code === 'cooldown') return 'A product email was just sent. Wait a minute before sending another.'
  return e.code.replaceAll('_', ' ')
}

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-border-subtle bg-surface/60 p-5', className)}>
      {title ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface/60 p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-medium tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

function Bars({ data, value, label }: { data: Array<Record<string, unknown>>; value: string; label: (row: Record<string, unknown>) => string }) {
  const max = Math.max(1e-9, ...data.map((d) => Number(d[value] ?? 0)))
  return (
    <div className="flex h-36 items-end gap-[3px]">
      {data.map((d, i) => {
        const v = Number(d[value] ?? 0)
        return (
          <div key={i} className="group relative flex-1" title={label(d)}>
            <div className="w-full rounded-t bg-foreground/70 group-hover:bg-foreground" style={{ height: `${Math.max(v > 0 ? 3 : 1, (v / max) * 136)}px` }} />
          </div>
        )
      })}
    </div>
  )
}

function Loading({ q }: { q: { isLoading: boolean; error: unknown } }) {
  if (q.isLoading) return <p className="text-sm text-muted">Loading…</p>
  if (q.error) return <p className="text-sm text-red-400">{errorText(q.error)}</p>
  return null
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>{head.map((h) => <th key={h} className="pb-2 pr-4 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border-subtle">
              {r.map((c, j) => <td key={j} className="py-2 pr-4 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────

type Overview = {
  users: Record<string, number>
  content: Record<string, number>
  ai: { cost24h: number; cost30d: number; requests24h: number }
  email: Record<string, number>
  daily: Array<{ day: string; signups: number; active: number }>
  recentSignups: Array<{ id: string; email: string; created_at: string; last_sign_in_at: string | null; confirmed: boolean }>
}

export function OverviewPage() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => adminApi<Overview>('overview'), refetchInterval: 60_000 })
  const d = q.data
  return (
    <div className="space-y-5">
      <Loading q={q} />
      {d ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Users" value={d.users.total} hint={`${d.users.confirmed} confirmed · ${d.users.locked} locked`} />
            <Stat label="New users" value={d.users.new_7d} hint={`7 days · ${d.users.new_30d} in 30 days`} />
            <Stat label="Signed in (7 days)" value={d.users.signed_in_7d} />
            <Stat label="AI cost" value={usd(d.ai.cost24h)} hint={`24 h · ${usd(d.ai.cost30d)} in 30 days`} />
            <Stat label="Workspaces" value={d.content.workspaces} hint={`${d.content.personal_projects} personal projects`} />
            <Stat label="Tasks created (7 days)" value={d.content.tasks_7d} />
            <Stat label="Meetings" value={d.content.meetings} hint={`${d.content.meeting_minutes} minutes recorded`} />
            <Stat label="Emails sent (7 days)" value={d.email.sent_7d} hint={`${d.email.queued} queued · ${d.email.failed_7d} failed`} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Daily active users (30 days)">
              <Bars data={d.daily} value="active" label={(r) => `${r.day}: ${r.active} active`} />
            </Panel>
            <Panel title="Sign-ups (30 days)">
              <Bars data={d.daily} value="signups" label={(r) => `${r.day}: ${r.signups} sign-ups`} />
            </Panel>
          </div>
          <Panel title="Latest sign-ups">
            <Table
              head={['Email', 'Joined', 'Last sign-in', 'Confirmed']}
              rows={d.recentSignups.map((u) => [u.email, when(u.created_at), when(u.last_sign_in_at), u.confirmed ? 'Yes' : 'No'])}
            />
          </Panel>
        </>
      ) : null}
    </div>
  )
}

// ── AI costs ─────────────────────────────────────────────────────────────────

type AiData = {
  days: number
  totals: { cost: number; requests: number; failed: number; tokens: number; audio_minutes: number; users: number }
  byDay: Array<{ day: string; cost: number; requests: number }>
  byFeature: Array<{ key: string; cost: number; requests: number }>
  byModel: Array<{ key: string; cost: number; requests: number }>
  topUsers: Array<{ id: string; email: string | null; cost: number; requests: number }>
  controls: { ai_enabled: boolean; transcription_enabled: boolean; analysis_enabled: boolean; max_global_daily_cost_usd: number | null } | null
}

const FEATURE: Record<string, string> = {
  chat: 'AI chat',
  daily_log: 'Daily log',
  meeting_transcribe: 'Meeting transcription',
  meeting_analyze: 'Meeting analysis',
  meeting_translate: 'Meeting translation',
}

export function AiPage() {
  const [days, setDays] = useState(30)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'ai', days], queryFn: () => adminApi<AiData>(`ai?days=${days}`) })
  const [cap, setCap] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => adminApi('ai/controls', { method: 'POST', body: patch }),
    onSuccess: async () => {
      toast.success('AI controls saved')
      setCap(null)
      await qc.invalidateQueries({ queryKey: ['admin', 'ai'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  const d = q.data
  const controls = d?.controls
  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-xl border border-border bg-surface-2/60 p-1">
        {[7, 30, 90, 365].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setDays(n)}
            className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', days === n ? 'bg-surface text-foreground shadow-sm' : 'text-muted')}
          >
            {n === 365 ? '1 year' : `${n} days`}
          </button>
        ))}
      </div>
      <Loading q={q} />
      {d ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Total cost (${d.days} days)`} value={usd(d.totals.cost)} />
            <Stat label="Requests" value={d.totals.requests} hint={`${d.totals.failed} failed`} />
            <Stat label="Tokens" value={Number(d.totals.tokens).toLocaleString()} hint={`${d.totals.audio_minutes} audio minutes`} />
            <Stat label="Users using AI" value={d.totals.users} />
          </div>
          <Panel title="Cost per day">
            <Bars data={d.byDay} value="cost" label={(r) => `${r.day}: ${usd(r.cost)} · ${r.requests} requests`} />
          </Panel>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="By feature">
              <Table head={['Feature', 'Cost', 'Requests']} rows={d.byFeature.map((r) => [FEATURE[r.key] ?? r.key, usd(r.cost), r.requests])} />
            </Panel>
            <Panel title="By model">
              <Table head={['Model', 'Cost', 'Requests']} rows={d.byModel.map((r) => [r.key, usd(r.cost), r.requests])} />
            </Panel>
          </div>
          <Panel title="Top users by cost">
            <Table head={['User', 'Cost', 'Requests']} rows={d.topUsers.map((r) => [r.email ?? r.id, usd(r.cost), r.requests])} />
          </Panel>
          {controls ? (
            <Panel title="AI controls (whole app)">
              <div className="space-y-4">
                {(
                  [
                    ['ai_enabled', 'AI enabled', 'Master switch for chat, daily logs and meetings AI.'],
                    ['transcription_enabled', 'Meeting transcription', 'Speech-to-text for recordings.'],
                    ['analysis_enabled', 'Meeting analysis', 'Summaries, decisions and action items.'],
                  ] as const
                ).map(([key, label, hint]) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted">{hint}</p>
                    </div>
                    <Switch checked={controls[key]} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ [key]: v })} />
                  </div>
                ))}
                <form
                  className="flex flex-wrap items-end gap-2 border-t border-border-subtle pt-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const value = (cap ?? '').trim()
                    save.mutate({ max_global_daily_cost_usd: value === '' ? null : Number(value) })
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="cap">Daily cost cap (USD, empty = none)</Label>
                    <Input
                      id="cap"
                      inputMode="decimal"
                      className="w-40"
                      value={cap ?? (controls.max_global_daily_cost_usd != null ? String(controls.max_global_daily_cost_usd) : '')}
                      onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))}
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={save.isPending || cap === null}>
                    Save cap
                  </Button>
                </form>
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

// ── Accounts ─────────────────────────────────────────────────────────────────

type AdminUserRow = {
  id: string
  email: string
  display_name: string | null
  created_at: string
  last_sign_in_at: string | null
  confirmed: boolean
  locked: boolean
  tier: string | null
  owned_workspaces: number
  memberships: number
  ai_cost_30d: number
  is_admin: boolean
}

export function AccountsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [terminate, setTerminate] = useState<AdminUserRow | null>(null)
  const [confirmEmail, setConfirmEmail] = useState('')
  const q = useQuery({
    queryKey: ['admin', 'users', query, page],
    queryFn: () => adminApi<{ users: AdminUserRow[]; hasMore: boolean }>(`users?q=${encodeURIComponent(query)}&page=${page}`),
  })
  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'lock' | 'unlock' | 'terminate'; body?: unknown }) =>
      adminApi(`users/${id}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: async (_r, v) => {
      toast.success(v.action === 'lock' ? 'Account locked; sessions ended' : v.action === 'unlock' ? 'Account unlocked' : 'Account deleted')
      setTerminate(null)
      setConfirmEmail('')
      await qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (e) => {
      if (e instanceof AdminApiError && e.code === 'owned_shared_workspaces') {
        const names = (e.data.workspaces as Array<{ name: string }> | undefined)?.map((w) => w.name).join(', ')
        return toast.error(`Owns workspaces with other members: ${names}. Transfer them first.`)
      }
      toast.error(errorText(e))
    },
  })

  return (
    <div className="space-y-5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(0)
          setQuery(search)
        }}
      >
        <Input placeholder="Search email or name" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <Loading q={q} />
      {q.data ? (
        <Panel>
          <Table
            head={['Account', 'Joined', 'Last sign-in', 'Status', 'AI 30d', 'Workspaces', '']}
            rows={q.data.users.map((u) => [
              <div key="a">
                <p className="font-medium">{u.email}</p>
                <p className="text-xs text-muted">{u.display_name ?? '—'}</p>
              </div>,
              when(u.created_at),
              when(u.last_sign_in_at),
              u.is_admin ? 'Admin' : u.locked ? <span className="text-red-400">Locked</span> : u.confirmed ? 'Active' : 'Unconfirmed',
              usd(u.ai_cost_30d),
              `${u.owned_workspaces} owned · ${u.memberships} member`,
              u.is_admin ? null : (
                <div key="x" className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ id: u.id, action: u.locked ? 'unlock' : 'lock' })}>
                    {u.locked ? 'Unlock' : 'Lock'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setTerminate(u)}>
                    Terminate
                  </Button>
                </div>
              ),
            ])}
          />
          <div className="mt-4 flex justify-between">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={!q.data.hasMore} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </Panel>
      ) : null}

      {terminate ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-lg font-medium">Permanently delete this account?</h2>
            <p className="mt-2 text-sm text-muted">
              {terminate.email} and their personal data are deleted. Workspaces they solely own are deleted too. This cannot be undone.
            </p>
            <Label htmlFor="confirm-email" className="mt-4 block">
              Type the email to confirm
            </Label>
            <Input id="confirm-email" className="mt-1.5" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTerminate(null)}>
                Cancel
              </Button>
              <Button
                className="bg-red-500 text-white hover:bg-red-600"
                disabled={act.isPending || confirmEmail.trim().toLowerCase() !== terminate.email.toLowerCase()}
                onClick={() => act.mutate({ id: terminate.id, action: 'terminate', body: { confirmEmail } })}
              >
                Delete account
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Product emails ──────────────────────────────────────────────────────────

type Content = {
  subject: string
  preheader: string
  heading: string
  body: string
  ctaLabel: string
  ctaUrl: string
  heroUrl: string
  heroAlt: string
}
const EMPTY: Content = { subject: '', preheader: '', heading: '', body: '', ctaLabel: '', ctaUrl: '', heroUrl: '', heroAlt: '' }
const filled = (c: Content) => Boolean(c.subject.trim() && c.heading.trim() && c.body.trim())
const clean = (c: Content) => ({
  subject: c.subject.trim(),
  heading: c.heading.trim(),
  body: c.body.trim(),
  ...(c.preheader.trim() ? { preheader: c.preheader.trim() } : {}),
  ...(c.ctaLabel.trim() && c.ctaUrl.trim() ? { ctaLabel: c.ctaLabel.trim(), ctaUrl: c.ctaUrl.trim() } : {}),
  ...(c.heroUrl ? { heroImage: { url: c.heroUrl, ...(c.heroAlt.trim() ? { alt: c.heroAlt.trim() } : {}) } } : {}),
})

type Audience = 'all' | 'en' | 'ar' | 'admin'

type BroadcastInfo = {
  sendingEnabled: boolean
  audience: Record<Audience, number>
  recent: Array<{ id: string; created_at: string; audience: string; recipients: number; subject: string | null }>
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'

function ImagePicker({ label, busy, onFile }: { label: string; busy: boolean; onFile: (file: File) => void }) {
  return (
    <label className={cn('inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 text-sm', busy && 'pointer-events-none opacity-60')}>
      <ImagePlus className="size-4" />
      {busy ? 'Uploading…' : label}
      <input
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
    </label>
  )
}

export function EmailsPage() {
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['admin', 'broadcasts'], queryFn: () => adminApi<BroadcastInfo>('broadcasts') })
  const [locale, setLocale] = useState<'en' | 'ar'>('en')
  const [audience, setAudience] = useState<Audience>('all')
  const [content, setContent] = useState<Record<'en' | 'ar', Content>>({ en: { ...EMPTY }, ar: { ...EMPTY } })
  const [preview, setPreview] = useState<Partial<Record<'en' | 'ar', string>>>({})
  const [confirm, setConfirm] = useState(false)
  const [uploading, setUploading] = useState<'hero' | 'inline' | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const payload = () => {
    const out: Partial<Record<'en' | 'ar', ReturnType<typeof clean>>> = {}
    for (const l of ['en', 'ar'] as const) if (filled(content[l])) out[l] = clean(content[l])
    return out
  }
  const ready =
    Object.keys(payload()).length > 0 && (audience === 'all' || audience === 'admin' || filled(content[audience]))
  const run = useMutation({
    mutationFn: (action: 'preview' | 'test' | 'send') =>
      adminApi<{ html?: Partial<Record<'en' | 'ar', string>>; queued?: number; sentToAdmin?: number }>('broadcasts', {
        method: 'POST',
        body: { action, audience, content: payload(), ...(action === 'send' ? { confirm: 'SEND' } : {}) },
      }),
    onSuccess: async (res, action) => {
      if (action === 'preview') setPreview(res.html ?? {})
      if (action === 'test') toast.success('Test sent to your email')
      if (action === 'send') {
        setConfirm(false)
        toast.success(res.sentToAdmin ? 'Sent to your email only' : `Queued for ${res.queued ?? 0} recipients`)
        await qc.invalidateQueries({ queryKey: ['admin', 'broadcasts'] })
      }
    },
    onError: (e) => toast.error(errorText(e)),
  })

  const current = content[locale]
  const update = (patch: Partial<Content>) => setContent((prev) => ({ ...prev, [locale]: { ...prev[locale], ...patch } }))
  const set = (field: keyof Content) => (e: { target: { value: string } }) => update({ [field]: e.target.value })

  function wrapSelection(before: string, after: string, placeholder: string) {
    const el = bodyRef.current
    const text = current.body
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const selected = text.slice(start, end) || placeholder
    update({ body: text.slice(0, start) + before + selected + after + text.slice(end) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  /** Make the paragraph at the cursor a title ("# ") or subtitle ("## "); again to remove. */
  function toggleHeading(prefix: '# ' | '## ') {
    const el = bodyRef.current
    const text = current.body
    const at = el?.selectionStart ?? text.length
    const blockStart = Math.max(text.lastIndexOf('\n\n', at - 1) + 2, 0)
    const head = text.slice(blockStart)
    const existing = head.match(/^#{1,2} /)?.[0] ?? ''
    const next = existing === prefix ? '' : prefix
    update({ body: text.slice(0, blockStart) + next + head.slice(existing.length) })
    requestAnimationFrame(() => el?.focus())
  }

  function insertLink() {
    const url = window.prompt('Link address (https://… or mailto:…)')?.trim()
    if (!url) return
    if (!/^(https:\/\/|mailto:)/i.test(url)) return toast.error('Links must start with https:// or mailto:')
    wrapSelection('[', `](${url})`, 'link text')
  }

  async function upload(file: File, kind: 'hero' | 'inline') {
    if (file.size > 3 * 1024 * 1024) return toast.error('Images can be up to 3 MB')
    setUploading(kind)
    try {
      const url = await uploadEmailImage(file)
      if (kind === 'hero') {
        update({ heroUrl: url })
      } else {
        // Insert as its own paragraph at the cursor (or at the end).
        const alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[[\]()]/g, '').slice(0, 80)
        const text = current.body
        const at = bodyRef.current?.selectionStart ?? text.length
        const before = text.slice(0, at).replace(/\s+$/, '')
        const after = text.slice(at).replace(/^\s+/, '')
        update({ body: [before, `![${alt}](${url})`, after].filter(Boolean).join('\n\n') })
      }
      toast.success('Image added')
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setUploading(null)
    }
  }

  const recipients = info.data?.audience[audience] ?? 0
  const sendLabel = audience === 'admin' ? 'Send to me only' : `Send to ${recipients}`

  return (
    <div className="space-y-5">
      <Loading q={info} />
      {info.data && !info.data.sendingEnabled ? (
        <Panel>
          <p className="text-sm text-muted">Sending is off until RESEND_API_KEY and EMAIL_UNSUBSCRIBE_SECRET are set. Preview still works.</p>
        </Panel>
      ) : null}
      <Panel title="Compose" action={<span className="text-xs text-muted">From Hilm &lt;noreply@hilm.tech&gt; · unsubscribe link included</span>}>
        <div className="mb-4 inline-flex rounded-xl border border-border bg-surface-2/60 p-1">
          {(['en', 'ar'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', locale === l ? 'bg-surface text-foreground shadow-sm' : 'text-muted')}
            >
              {l === 'en' ? 'English' : 'العربية'}
              {filled(content[l]) ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Header image (optional)</Label>
            {current.heroUrl ? (
              <div className="space-y-2">
                <img src={current.heroUrl} alt="" className="max-h-48 rounded-xl border border-border-subtle object-cover" />
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Image description (for screen readers and blocked images)"
                    maxLength={150}
                    value={current.heroAlt}
                    onChange={set('heroAlt')}
                    className="max-w-md"
                  />
                  <Button size="sm" variant="ghost" onClick={() => update({ heroUrl: '', heroAlt: '' })}>
                    <X className="size-4" /> Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <ImagePicker label="Upload header image" busy={uploading === 'hero'} onFile={(f) => void upload(f, 'hero')} />
              </div>
            )}
          </div>
          <div className="space-y-1.5"><Label>Subject</Label><Input maxLength={150} value={current.subject} onChange={set('subject')} /></div>
          <div className="space-y-1.5"><Label>Preview text (optional)</Label><Input maxLength={150} value={current.preheader} onChange={set('preheader')} /></div>
          <div className="space-y-1.5"><Label>Heading</Label><Input maxLength={160} value={current.heading} onChange={set('heading')} /></div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Message</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" size="sm" variant="secondary" title="Title (# )" onClick={() => toggleHeading('# ')}>
                  <Heading1 className="size-4" />
                </Button>
                <Button type="button" size="sm" variant="secondary" title="Subtitle (## )" onClick={() => toggleHeading('## ')}>
                  <Heading2 className="size-4" />
                </Button>
                <Button type="button" size="sm" variant="secondary" title="Bold (*text*)" onClick={() => wrapSelection('*', '*', 'bold text')}>
                  <Bold className="size-4" />
                </Button>
                <Button type="button" size="sm" variant="secondary" title="Link ([text](https://…))" onClick={insertLink}>
                  <Link2 className="size-4" />
                </Button>
                <ImagePicker label="Insert image" busy={uploading === 'inline'} onFile={(f) => void upload(f, 'inline')} />
              </div>
            </div>
            <Textarea ref={bodyRef} rows={12} maxLength={8000} value={current.body} onChange={set('body')} />
            <p className="text-xs text-muted">
              Blank line between paragraphs. <code># Title</code>, <code>## Subtitle</code>, <code>*bold*</code>,{' '}
              <code>[text](https://…)</code> for links. Images appear where their ![description](link) line is (PNG, JPEG, GIF or WebP up to 3 MB).
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Button label (optional)</Label><Input maxLength={40} value={current.ctaLabel} onChange={set('ctaLabel')} /></div>
            <div className="space-y-1.5"><Label>Button link (hilm.tech / app.hilm.tech)</Label><Input dir="ltr" value={current.ctaUrl} onChange={set('ctaUrl')} /></div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
          <select className="h-9 rounded-lg border border-border bg-surface px-3 text-sm" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            <option value="all">Everyone ({info.data?.audience.all ?? 0})</option>
            <option value="en">English users ({info.data?.audience.en ?? 0})</option>
            <option value="ar">Arabic users ({info.data?.audience.ar ?? 0})</option>
            <option value="admin">Only me (admin)</option>
          </select>
          <Button variant="secondary" disabled={!ready || run.isPending} onClick={() => run.mutate('preview')}>Preview</Button>
          <Button variant="secondary" disabled={!ready || run.isPending || !info.data?.sendingEnabled} onClick={() => run.mutate('test')}>Send test to me</Button>
          <Button disabled={!ready || !recipients || !info.data?.sendingEnabled} onClick={() => setConfirm(true)}>{sendLabel}</Button>
        </div>
      </Panel>
      {Object.keys(preview).length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {(['en', 'ar'] as const).map((l) =>
            preview[l] ? <iframe key={l} title={`preview-${l}`} sandbox="" srcDoc={preview[l]} className="h-[720px] w-full rounded-2xl border border-border-subtle bg-black" /> : null,
          )}
        </div>
      ) : null}
      {info.data?.recent.length ? (
        <Panel title="Sent">
          <Table
            head={['Subject', 'Sent', 'Audience', 'Recipients']}
            rows={info.data.recent.map((b) => [b.subject ?? '—', when(b.created_at), b.audience === 'admin' ? 'Only me' : b.audience, b.recipients])}
          />
        </Panel>
      ) : null}
      {confirm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-lg font-medium">{audience === 'admin' ? 'Send this email to yourself?' : `Send to ${recipients} people?`}</h2>
            <p className="mt-2 text-sm text-muted">
              {audience === 'admin'
                ? 'The final email (no [Test] prefix), only to your admin address.'
                : 'It goes out now and cannot be recalled.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button disabled={run.isPending} onClick={() => run.mutate('send')}>Send now</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Security & audit ────────────────────────────────────────────────────────

export function SecurityPage() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['admin', 'security'],
    queryFn: () => adminApi<{ current: string; networks: Array<{ prefix: string; label: string | null; created_at: string; last_seen_at: string }> }>('security'),
  })
  const remove = useMutation({
    mutationFn: (prefix: string) => adminApi('security/networks/remove', { method: 'POST', body: { prefix } }),
    onSuccess: async () => {
      toast.success('Network removed')
      await qc.invalidateQueries({ queryKey: ['admin', 'security'] })
    },
    onError: (e) => toast.error(errorText(e)),
  })
  return (
    <div className="space-y-5">
      <Loading q={q} />
      {q.data ? (
        <Panel title="Approved networks">
          <p className="mb-4 text-xs text-muted">Requests from any other network are refused, even with your password and code.</p>
          <Table
            head={['Network', 'Added', 'Last used', '']}
            rows={q.data.networks.map((n) => [
              <span key="p" className="font-mono text-xs">{n.prefix}{n.prefix === q.data!.current ? ' (this device)' : ''}</span>,
              `${when(n.created_at)} · ${n.label ?? ''}`,
              when(n.last_seen_at),
              n.prefix === q.data!.current ? null : (
                <Button key="r" size="sm" variant="ghost" onClick={() => remove.mutate(n.prefix)}>Remove</Button>
              ),
            ])}
          />
        </Panel>
      ) : null}
    </div>
  )
}

export function AuditPage() {
  const q = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => adminApi<{ entries: Array<{ id: string; at: string; action: string; target: string | null; network: string | null }> }>('audit'),
  })
  return (
    <div className="space-y-5">
      <Loading q={q} />
      {q.data ? (
        <Panel title="Audit log (append-only)">
          <Table
            head={['When', 'Action', 'Target', 'Network']}
            rows={q.data.entries.map((e) => [when(e.at), e.action.replaceAll('_', ' '), <span key="t" className="font-mono text-xs">{e.target ?? '—'}</span>, <span key="n" className="font-mono text-xs">{e.network ?? '—'}</span>])}
          />
        </Panel>
      ) : null}
    </div>
  )
}
