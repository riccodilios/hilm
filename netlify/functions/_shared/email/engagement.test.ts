import { describe, expect, it, vi } from 'vitest'
import { loadEmailConfig } from './config.ts'
import {
  drainOutbox,
  mergeChanges,
  type AssignedItem,
  type BroadcastItem,
  type OutboxRow,
  type OutboxStore,
  type RecipientRow,
} from './outbox.ts'
import type { EmailService, SendInput } from './service.ts'
import { authEmail } from './templates-engagement.ts'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const WS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const recipient = (over: Partial<RecipientRow> = {}): RecipientRow => ({
  email: 'person@example.com',
  email_confirmed: true,
  display_name: 'Sara',
  locale: 'en',
  time_zone: 'UTC',
  time_format: '24h',
  email_reminders_enabled: true,
  email_workspace_enabled: true,
  email_marketing_enabled: true,
  suppressed: false,
  ...over,
})

const task = (n: number, over: Partial<AssignedItem> = {}): AssignedItem => ({
  taskId: id(n),
  title: `Task ${n}`,
  taskNumber: n,
  status: 'in_progress',
  dueAt: null,
  dueDate: '2026-11-02',
  assigneeId: USER,
  workspaceId: WS,
  workspaceName: 'Acme',
  taskKey: 'ACME',
  isMember: true,
  wantsMentions: true,
  wantsTaskUpdates: true,
  priority: 'high',
  createdBy: ACTOR,
  reminderAt: new Date(NOW - 30_000).toISOString(),
  ...over,
})

const row = (n: number, over: Partial<OutboxRow>): OutboxRow => ({
  id: id(n),
  kind: 'workspace_task_updated',
  user_id: USER,
  payload: {},
  group_key: null,
  batch_key: null,
  attempts: 1,
  created_at: new Date(NOW - 60_000).toISOString(),
  ...over,
})

function harness(data: {
  rows: OutboxRow[]
  recipient?: RecipientRow
  tasks?: Record<string, AssignedItem | null>
  comments?: Record<string, { content: string; authorId: string; taskId: string }>
  broadcast?: BroadcastItem | null
  env?: Record<string, string>
}) {
  const skipped: string[] = []
  const sent: string[][] = []
  const store: OutboxStore = {
    claimDue: vi.fn(async () => data.rows),
    loadRecipient: vi.fn(async () => data.recipient ?? recipient()),
    loadTaskReminder: vi.fn(async () => null),
    loadAssignedTask: vi.fn(async (tid) => data.tasks?.[tid] ?? null),
    loadMention: vi.fn(async () => null),
    loadComment: vi.fn(async (cid) => data.comments?.[cid] ?? null),
    loadBroadcast: vi.fn(async () => data.broadcast ?? null),
    displayNames: vi.fn(async () => new Map([[ACTOR, 'Omar']])),
    assignBatch: vi.fn(async () => undefined),
    markSent: vi.fn(async (ids) => void sent.push(ids)),
    markSkipped: vi.fn(async (_ids, reason) => void skipped.push(reason)),
    scheduleRetry: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
  const sends: SendInput[] = []
  const service: EmailService = {
    enabled: true,
    send: vi.fn(async (input: SendInput) => {
      sends.push(input)
      return { ok: true as const, id: 'msg' }
    }),
  }
  const config = loadEmailConfig({ RESEND_API_KEY: 're_test', ...data.env })
  const run = () => drainOutbox({ store, service, config, now: () => NOW, log: () => undefined }, { paceMs: 0 })
  return { run, sends, skipped, sent }
}

describe('task update emails', () => {
  const group = `workspace-task-updated/${WS}/${USER}`

  it('merges several changes per task and lists tasks in one digest', async () => {
    const rows = [
      row(1, { group_key: group, payload: { task_id: id(10), actor_id: ACTOR, changes: { status: { from: 'todo', to: 'in_progress' } } } }),
      row(2, { group_key: group, payload: { task_id: id(10), actor_id: ACTOR, changes: { status: { from: 'in_progress', to: 'done' } } } }),
      row(3, { group_key: group, payload: { task_id: id(11), actor_id: ACTOR, comment_id: id(50), changes: { comment: true } } }),
    ]
    const { run, sends, sent } = harness({
      rows,
      tasks: { [id(10)]: task(10, { status: 'done' }), [id(11)]: task(11) },
      comments: { [id(50)]: { content: `Looks good @{${ACTOR}}`, authorId: ACTOR, taskId: id(11) } },
    })
    await run()
    expect(sends).toHaveLength(1)
    expect(sends[0]!.subject).toBe('2 updates on your tasks in Acme')
    expect(sends[0]!.text).toContain('Status: To do → Done · by Omar')
    expect(sends[0]!.text).toContain('New comment: “Looks good @Omar”')
    expect(sent[0]).toEqual(rows.map((r) => r.id))
  })

  it('respects the "Task updates" switch and reassignment', async () => {
    const rows = [
      row(1, { payload: { task_id: id(10), actor_id: ACTOR, changes: { due: true } } }),
      row(2, { payload: { task_id: id(11), actor_id: ACTOR, changes: { due: true } } }),
    ]
    const { run, sends, skipped } = harness({
      rows,
      tasks: { [id(10)]: task(10, { wantsTaskUpdates: false }), [id(11)]: task(11, { assigneeId: ACTOR }) },
    })
    await run()
    expect(sends).toHaveLength(0)
    expect(skipped).toEqual(['preference_off', 'reassigned'])
  })

  it('validates change records from the queue', () => {
    expect(mergeChanges([{ status: { from: 'todo', to: 'todo' } }, { evil: '<x>' }, null])).toEqual({})
    expect(mergeChanges([{ priority: { from: 'low', to: 'high' }, title: true }])).toEqual({
      priority: { from: 'low', to: 'high' },
      title: true,
    })
  })
})

describe('workspace task reminder emails', () => {
  it('reminds the assignee and honours the reminder email switch', async () => {
    const r = row(1, { kind: 'workspace_task_reminder', payload: { task_id: id(10) } })
    const ok = harness({ rows: [r], tasks: { [id(10)]: task(10) } })
    await ok.run()
    expect(ok.sends[0]!.subject).toBe('Reminder: ACME-10 · Task 10')

    const off = harness({ rows: [r], recipient: recipient({ email_reminders_enabled: false }), tasks: { [id(10)]: task(10) } })
    await off.run()
    expect(off.sends).toHaveLength(0)
    expect(off.skipped).toEqual(['preference_off'])

    const done = harness({ rows: [r], tasks: { [id(10)]: task(10, { status: 'done' }) } })
    await done.run()
    expect(done.skipped).toEqual(['task_closed'])
  })
})

describe('broadcast emails', () => {
  const broadcast: BroadcastItem = {
    audience: 'all',
    createdAt: new Date(NOW - 60_000).toISOString(),
    content: {
      en: { subject: 'New in Hilm', heading: 'Hello', body: 'News.' },
      ar: { subject: 'جديد في حلم', heading: 'مرحباً', body: 'أخبار.' },
    },
  }
  const r = row(1, { kind: 'broadcast', payload: { broadcast_id: id(90) } })

  it('sends the recipient language from noreply with one-click unsubscribe', async () => {
    const h = harness({ rows: [r], recipient: recipient({ locale: 'ar' }), broadcast, env: { EMAIL_UNSUBSCRIBE_SECRET: 'k'.repeat(40) } })
    await h.run()
    expect(h.sends[0]!.category).toBe('marketing')
    expect(h.sends[0]!.subject).toBe('جديد في حلم')
    expect(h.sends[0]!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(h.sends[0]!.text).toContain(`/api/email-unsubscribe?u=${USER}&t=`)
  })

  it('skips people who opted out, and everything without an unsubscribe secret', async () => {
    const out = harness({ rows: [r], recipient: recipient({ email_marketing_enabled: false }), broadcast, env: { EMAIL_UNSUBSCRIBE_SECRET: 'k'.repeat(40) } })
    await out.run()
    expect(out.skipped).toEqual(['preference_off'])
    const noSecret = harness({ rows: [r], broadcast })
    await noSecret.run()
    expect(noSecret.sends).toHaveLength(0)
    expect(noSecret.skipped).toEqual(['not_configured'])
  })
})

describe('authEmail template', () => {
  it('shows the code prominently and ignores malformed codes', () => {
    const ok = authEmail({ locale: 'en', action: 'signup', code: '482913', confirmUrl: 'https://abc.supabase.co/auth/v1/verify?token=x&type=signup&redirect_to=y' })
    expect(ok.html).toContain('482913')
    expect(ok.html).toContain('letter-spacing:0.28em')
    const bad = authEmail({ locale: 'en', action: 'signup', code: '<b>1</b>', confirmUrl: null })
    expect(bad.html).not.toContain('<b>1</b>')
    expect(bad.subject).toBe('Confirm your Hilm account')
  })
})
