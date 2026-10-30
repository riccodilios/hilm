import { describe, expect, it, vi } from 'vitest'
import { loadEmailConfig } from './config.ts'
import {
  MAX_ATTEMPTS,
  drainOutbox,
  mentionSnippet,
  planBatches,
  retryDelaySeconds,
  type AssignedItem,
  type MentionItem,
  type OutboxRow,
  type OutboxStore,
  type RecipientRow,
  type ReminderItem,
} from './outbox.ts'
import type { EmailService, SendInput, SendResult } from './service.ts'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const WS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const config = loadEmailConfig({ RESEND_API_KEY: 're_test' })

const recipient = (over: Partial<RecipientRow> = {}): RecipientRow => ({
  email: 'person@example.com',
  email_confirmed: true,
  display_name: 'Sara',
  locale: 'en',
  time_zone: 'Asia/Riyadh',
  time_format: '24h',
  email_reminders_enabled: true,
  email_workspace_enabled: true,
  suppressed: false,
  ...over,
})

const row = (n: number, over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: id(n),
  kind: 'task_reminder',
  user_id: USER,
  payload: { reminder_id: id(100 + n) },
  group_key: null,
  batch_key: null,
  attempts: 1,
  created_at: new Date(NOW - 60_000).toISOString(),
  ...over,
})

const reminder = (over: Partial<ReminderItem> = {}): ReminderItem => ({
  remindAt: new Date(NOW - 30_000).toISOString(),
  taskId: id(200),
  title: 'Ship v2',
  status: 'todo',
  priority: 'high',
  dueAt: '2026-10-30T13:00:00Z',
  dueDate: null,
  dueTime: null,
  projectName: 'Launch',
  projectEmail: null,
  ...over,
})

const assigned = (taskN: number, over: Partial<AssignedItem> = {}): AssignedItem => ({
  taskId: id(taskN),
  title: `Task ${taskN}`,
  taskNumber: taskN,
  status: 'todo',
  dueAt: null,
  dueDate: null,
  assigneeId: USER,
  workspaceId: WS,
  workspaceName: 'Acme',
  taskKey: 'ACME',
  isMember: true,
  wantsMentions: true,
  ...over,
})

function fakeStore(data: {
  rows: OutboxRow[]
  recipient?: RecipientRow | null
  reminders?: Record<string, ReminderItem | null>
  tasks?: Record<string, AssignedItem | null>
  mentions?: Record<string, MentionItem | null>
}) {
  const state = {
    sent: [] as Array<{ ids: string[]; messageId: string }>,
    skipped: [] as Array<{ ids: string[]; reason: string }>,
    retried: [] as Array<{ ids: string[]; delay: number; code: string }>,
    failed: [] as Array<{ ids: string[]; code: string }>,
    batches: [] as Array<{ key: string; ids: string[] }>,
  }
  const store: OutboxStore = {
    claimDue: vi.fn(async () => data.rows),
    loadRecipient: vi.fn(async () => (data.recipient === undefined ? recipient() : data.recipient)),
    loadTaskReminder: vi.fn(async (rid) => data.reminders?.[rid] ?? null),
    loadAssignedTask: vi.fn(async (tid) => data.tasks?.[tid] ?? null),
    loadMention: vi.fn(async (cid) => data.mentions?.[cid] ?? null),
    displayNames: vi.fn(async () => new Map([[OTHER, 'Omar']])),
    assignBatch: vi.fn(async (key, ids) => void state.batches.push({ key, ids })),
    markSent: vi.fn(async (ids, messageId) => void state.sent.push({ ids, messageId })),
    markSkipped: vi.fn(async (ids, reason) => void state.skipped.push({ ids, reason })),
    scheduleRetry: vi.fn(async (ids, delay, code) => void state.retried.push({ ids, delay, code })),
    markFailed: vi.fn(async (ids, code) => void state.failed.push({ ids, code })),
    release: vi.fn(async () => undefined),
  }
  return { store, state }
}

function fakeService(result: SendResult = { ok: true, id: 'msg_1' }, enabled = true) {
  const sends: SendInput[] = []
  const service: EmailService = {
    enabled,
    send: vi.fn(async (input: SendInput) => {
      sends.push(input)
      return result
    }),
  }
  return { service, sends }
}

const run = (store: OutboxStore, service: EmailService) =>
  drainOutbox({ store, service, config, now: () => NOW, log: () => undefined }, { paceMs: 0 })

describe('drainOutbox — task reminders', () => {
  it('sends a reminder with a per-batch idempotency key and marks it sent', async () => {
    const r = row(1)
    const { store, state } = fakeStore({ rows: [r], reminders: { [id(101)]: reminder() } })
    const { service, sends } = fakeService()
    const result = await run(store, service)
    expect(result.sent).toBe(1)
    expect(sends).toHaveLength(1)
    expect(sends[0]!.to).toBe('person@example.com')
    expect(sends[0]!.idempotencyKey).toBe(`hilm/task_reminder/${r.id}`)
    expect(sends[0]!.subject).toBe('Reminder: Ship v2')
    // Due time rendered in the recipient's zone (Riyadh = UTC+3).
    expect(sends[0]!.text).toContain('16:00')
    expect(state.batches).toEqual([{ key: r.id, ids: [r.id] }])
    expect(state.sent).toEqual([{ ids: [r.id], messageId: 'msg_1' }])
  })

  it.each([
    ['account email reminders off', { recipient: recipient({ email_reminders_enabled: false }) }, 'preference_off'],
    ['suppressed address', { recipient: recipient({ suppressed: true }) }, 'suppressed'],
    ['unconfirmed address', { recipient: recipient({ email_confirmed: false }) }, 'unconfirmed'],
    ['invalid address', { recipient: recipient({ email: 'nope' }) }, 'invalid_recipient'],
    ['deleted user', { recipient: null }, 'no_recipient'],
  ])('skips when %s', async (_label, over, reason) => {
    const { store, state } = fakeStore({ rows: [row(1)], reminders: { [id(101)]: reminder() }, ...over })
    const { service, sends } = fakeService()
    await run(store, service)
    expect(sends).toHaveLength(0)
    expect(state.skipped[0]?.reason).toBe(reason)
  })

  it.each([
    ['project email reminders off', reminder({ projectEmail: false }), 'preference_off'],
    ['task already done', reminder({ status: 'done' }), 'task_closed'],
    ['reminder older than six hours', reminder({ remindAt: new Date(NOW - 7 * 3600_000).toISOString() }), 'stale'],
    ['reminder deleted', null, 'not_found'],
  ])('skips when %s', async (_label, item, reason) => {
    const { store, state } = fakeStore({ rows: [row(1)], reminders: { [id(101)]: item } })
    const { service, sends } = fakeService()
    await run(store, service)
    expect(sends).toHaveLength(0)
    expect(state.skipped[0]?.reason).toBe(reason)
  })

  it('drops everything when sending is not configured instead of delivering late', async () => {
    const { store, state } = fakeStore({ rows: [row(1), row(2)] })
    const { service, sends } = fakeService(undefined, false)
    await run(store, service)
    expect(sends).toHaveLength(0)
    expect(state.skipped).toEqual([{ ids: [id(1), id(2)], reason: 'not_configured' }])
  })
})

describe('drainOutbox — retries and duplicates', () => {
  it('schedules a retry for transient errors and keeps the batch key', async () => {
    const r = row(1, { attempts: 2 })
    const { store, state } = fakeStore({ rows: [r], reminders: { [id(101)]: reminder() } })
    const { service } = fakeService({ ok: false, code: 'rate_limited', retryable: true })
    await run(store, service)
    expect(state.retried).toEqual([{ ids: [r.id], delay: 300, code: 'rate_limited' }])
    expect(state.failed).toEqual([])
  })

  it('marks failed after the last attempt or on permanent errors', async () => {
    const last = fakeStore({ rows: [row(1, { attempts: MAX_ATTEMPTS })], reminders: { [id(101)]: reminder() } })
    await run(last.store, fakeService({ ok: false, code: 'provider_unavailable', retryable: true }).service)
    expect(last.state.failed[0]?.code).toBe('provider_unavailable')

    const permanent = fakeStore({ rows: [row(1)], reminders: { [id(101)]: reminder() } })
    await run(permanent.store, fakeService({ ok: false, code: 'rejected', retryable: false }).service)
    expect(permanent.state.failed[0]?.code).toBe('rejected')
  })

  it('reuses the stored batch key on retry so Resend deduplicates the send', async () => {
    const retry = row(1, { batch_key: id(9), attempts: 3 })
    const { store, state } = fakeStore({ rows: [retry], reminders: { [id(101)]: reminder() } })
    const { service, sends } = fakeService()
    await run(store, service)
    expect(sends[0]!.idempotencyKey).toBe(`hilm/task_reminder/${id(9)}`)
    expect(state.batches).toEqual([])
  })

  it('computes the retry schedule', () => {
    expect([1, 2, 3, 4].map(retryDelaySeconds)).toEqual([60, 300, 900, 3600])
    expect(retryDelaySeconds(MAX_ATTEMPTS)).toBeNull()
  })
})

describe('drainOutbox — workspace assignments', () => {
  const group = `workspace-task-assigned/${WS}/${USER}`
  const assignmentRow = (n: number, taskN: number, actor = OTHER) =>
    row(n, {
      kind: 'workspace_task_assigned',
      payload: { task_id: id(taskN), workspace_id: WS, actor_id: actor },
      group_key: group,
    })

  it('groups a burst of assignments into one digest email', async () => {
    const rows = [assignmentRow(1, 301), assignmentRow(2, 302), assignmentRow(3, 303)]
    const { store, state } = fakeStore({
      rows,
      tasks: { [id(301)]: assigned(301), [id(302)]: assigned(302), [id(303)]: assigned(303) },
    })
    const { service, sends } = fakeService()
    await run(store, service)
    expect(sends).toHaveLength(1)
    expect(sends[0]!.subject).toBe('3 tasks assigned to you in Acme')
    expect(sends[0]!.text).toContain('Omar assigned these tasks to you in Acme.')
    expect(sends[0]!.idempotencyKey).toBe(`hilm/workspace_task_assigned/${id(1)}`)
    expect(state.sent[0]!.ids).toEqual(rows.map((r) => r.id))
  })

  it('only emails the current assignee who is still a member and wants these notifications', async () => {
    const rows = [assignmentRow(1, 301), assignmentRow(2, 302), assignmentRow(3, 303), assignmentRow(4, 304)]
    const { store, state } = fakeStore({
      rows,
      tasks: {
        [id(301)]: assigned(301, { assigneeId: OTHER }),
        [id(302)]: assigned(302, { isMember: false }),
        [id(303)]: assigned(303, { wantsMentions: false }),
        [id(304)]: assigned(304),
      },
    })
    const { service, sends } = fakeService()
    await run(store, service)
    expect(state.skipped.map((s) => s.reason)).toEqual(['reassigned', 'not_member', 'preference_off'])
    expect(sends).toHaveLength(1)
    expect(sends[0]!.subject).toBe('Assigned to you: ACME-304 · Task 304')
  })

  it('respects the account-level workspace email switch', async () => {
    const { store, state } = fakeStore({
      rows: [assignmentRow(1, 301)],
      recipient: recipient({ email_workspace_enabled: false }),
      tasks: { [id(301)]: assigned(301) },
    })
    const { service, sends } = fakeService()
    await run(store, service)
    expect(sends).toHaveLength(0)
    expect(state.skipped[0]?.reason).toBe('preference_off')
  })
})

describe('drainOutbox — mentions', () => {
  it('emails the mention with names resolved and skips removed mentions', async () => {
    const comment = (n: number, over: Partial<MentionItem> = {}): MentionItem => ({
      commentId: id(n),
      content: `@{${USER}} please review`,
      authorId: OTHER,
      taskId: id(400),
      taskTitle: 'Review',
      taskNumber: 7,
      workspaceId: WS,
      workspaceName: 'Acme',
      taskKey: 'ACME',
      mentionExists: true,
      isMember: true,
      wantsMentions: true,
      ...over,
    })
    const rows = [1, 2].map((n) =>
      row(n, {
        kind: 'workspace_mention',
        payload: { comment_id: id(500 + n) },
        group_key: `workspace-mention/${WS}/${USER}`,
      }),
    )
    const { store, state } = fakeStore({
      rows,
      mentions: { [id(501)]: comment(501), [id(502)]: comment(502, { mentionExists: false }) },
    })
    const { service, sends } = fakeService()
    await run(store, service)
    expect(state.skipped.map((s) => s.reason)).toEqual(['mention_removed'])
    expect(sends).toHaveLength(1)
    expect(sends[0]!.subject).toBe('Omar mentioned you in ACME-7')
    expect(sends[0]!.text).toContain('@member please review')
  })

  it('renders mention tokens as names', () => {
    expect(mentionSnippet(`hi @{${OTHER}} and @{${USER}}`, new Map([[OTHER, 'Omar']]))).toBe('hi @Omar and @member')
  })
})

describe('planBatches', () => {
  it('keeps retried rows in their batch and groups new rows by group key', () => {
    const batches = planBatches([
      row(1, { batch_key: 'b1' }),
      row(2, { group_key: 'g' }),
      row(3, { group_key: 'g' }),
      row(4),
    ])
    expect(batches.map((b) => [b.key, b.rows.map((r) => r.id), b.isNew])).toEqual([
      ['b1', [id(1)], false],
      [id(2), [id(2), id(3)], true],
      [id(4), [id(4)], true],
    ])
  })
})
