/**
 * Outbox dispatcher. Rows are queued by trusted code (reminder job, database triggers). Each run
 * claims due rows, re-checks them against live data (still assigned, still a member, preferences,
 * suppressions, staleness), renders one email per batch and sends it with an idempotency key that
 * is fixed for the batch, so crashes and retries never deliver twice.
 */
import type { EmailConfig } from './config.ts'
import { formatDue, normalizeLocale, safeTimeZone, type Recipient } from './format.ts'
import { logEmail, type EmailLogger } from './log.ts'
import type { EmailService, SendResult } from './service.ts'
import {
  taskReminderEmail,
  workspaceMentionEmail,
  workspaceTaskAssignedEmail,
  type RenderedEmail,
} from './templates.ts'
import {
  broadcastEmail,
  workspaceTaskReminderEmail,
  workspaceTaskUpdatesEmail,
  type BroadcastContent,
  type TaskUpdate,
} from './templates-engagement.ts'
import { isUuid, isValidEmailAddress } from './text.ts'
import { unsubscribeUrl } from './unsubscribe.ts'

export type OutboxKind =
  | 'task_reminder'
  | 'workspace_task_assigned'
  | 'workspace_mention'
  | 'workspace_task_updated'
  | 'workspace_task_reminder'
  | 'broadcast'

export type OutboxRow = {
  id: string
  kind: OutboxKind
  user_id: string
  payload: Record<string, unknown>
  group_key: string | null
  batch_key: string | null
  attempts: number
  created_at: string | Date
}

export type RecipientRow = {
  email: string | null
  email_confirmed: boolean
  display_name: string | null
  locale: string | null
  time_zone: string | null
  time_format: string | null
  email_reminders_enabled: boolean | null
  email_workspace_enabled: boolean | null
  email_marketing_enabled: boolean | null
  suppressed: boolean
}

export type ReminderItem = {
  remindAt: string | Date
  taskId: string
  title: string
  status: string
  priority: string
  dueAt: string | Date | null
  dueDate: string | null
  dueTime: string | null
  projectName: string
  projectEmail: boolean | null
}

export type AssignedItem = {
  taskId: string
  title: string
  taskNumber: number | null
  status: string
  dueAt: string | Date | null
  dueDate: string | null
  assigneeId: string | null
  workspaceId: string
  workspaceName: string
  taskKey: string | null
  isMember: boolean
  /** Workspace profile → "Mentions and assignments". */
  wantsMentions: boolean
  /** Workspace profile → "Task updates". */
  wantsTaskUpdates: boolean
  priority: string
  createdBy: string | null
  reminderAt: string | Date | null
}

export type CommentItem = { content: string; authorId: string; taskId: string }

export type BroadcastItem = {
  audience: 'all' | 'en' | 'ar'
  content: Partial<Record<'en' | 'ar', BroadcastContent>>
  createdAt: string | Date
}

export type MentionItem = {
  commentId: string
  content: string
  authorId: string
  taskId: string
  taskTitle: string
  taskNumber: number | null
  workspaceId: string
  workspaceName: string
  taskKey: string | null
  mentionExists: boolean
  isMember: boolean
  wantsMentions: boolean
}

export type OutboxStore = {
  claimDue(limit: number, kinds: OutboxKind[] | null): Promise<OutboxRow[]>
  loadRecipient(userId: string): Promise<RecipientRow | null>
  loadTaskReminder(reminderId: string, userId: string): Promise<ReminderItem | null>
  loadAssignedTask(taskId: string, userId: string): Promise<AssignedItem | null>
  loadMention(commentId: string, userId: string): Promise<MentionItem | null>
  loadComment(commentId: string): Promise<CommentItem | null>
  loadBroadcast(broadcastId: string): Promise<BroadcastItem | null>
  displayNames(workspaceId: string, userIds: string[]): Promise<Map<string, string>>
  assignBatch(batchKey: string, ids: string[]): Promise<void>
  markSent(ids: string[], messageId: string): Promise<void>
  markSkipped(ids: string[], reason: string): Promise<void>
  scheduleRetry(ids: string[], delaySeconds: number, code: string): Promise<void>
  markFailed(ids: string[], code: string): Promise<void>
  release(ids: string[]): Promise<void>
}

export const MAX_ATTEMPTS = 5
const RETRY_DELAYS = [60, 300, 900, 3600]
const REMINDER_STALE_MS = 6 * 60 * 60 * 1000
const WORKSPACE_STALE_MS = 24 * 60 * 60 * 1000
const BROADCAST_STALE_MS = 3 * 24 * 60 * 60 * 1000
const CLOSED = new Set(['done', 'archived', 'cancelled'])

/** Seconds until the next attempt, or null once the row should be marked failed. */
export function retryDelaySeconds(attempts: number) {
  if (attempts >= MAX_ATTEMPTS) return null
  return RETRY_DELAYS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS.length - 1)]!
}

export type Batch = { key: string; kind: OutboxKind; userId: string; rows: OutboxRow[]; isNew: boolean }

/**
 * Rows already given a batch_key (a previous attempt) keep it, so the retry reuses the same
 * idempotency key. New rows are grouped by group_key (digest) or stand alone.
 */
export function planBatches(rows: OutboxRow[]): Batch[] {
  const batches = new Map<string, Batch>()
  for (const row of rows) {
    const existing = row.batch_key
    const key = existing ?? (row.group_key ? `g:${row.kind}:${row.user_id}:${row.group_key}` : row.id)
    const batch = batches.get(key)
    if (batch) batch.rows.push(row)
    else batches.set(key, { key, kind: row.kind, userId: row.user_id, rows: [row], isNew: !existing })
  }
  // New batches are keyed by their first row id (stable, short, unique).
  return [...batches.values()].map((b) => (b.isNew ? { ...b, key: b.rows[0]!.id } : b))
}

export function idempotencyKeyFor(batch: { kind: OutboxKind; key: string }) {
  return `hilm/${batch.kind}/${batch.key}`
}

const ms = (value: string | Date) => new Date(value).getTime()

export function reminderSkipReason(item: ReminderItem | null, now: number): string | null {
  if (!item) return 'not_found'
  if (CLOSED.has(item.status)) return 'task_closed'
  if (item.projectEmail === false) return 'preference_off'
  if (now - ms(item.remindAt) > REMINDER_STALE_MS) return 'stale'
  return null
}

export function assignedSkipReason(item: AssignedItem | null, userId: string): string | null {
  if (!item) return 'not_found'
  if (item.assigneeId !== userId) return 'reassigned'
  if (!item.isMember) return 'not_member'
  if (!item.wantsMentions) return 'preference_off'
  if (CLOSED.has(item.status)) return 'task_closed'
  return null
}

export function mentionSkipReason(item: MentionItem | null, userId: string): string | null {
  if (!item) return 'not_found'
  if (!item.mentionExists) return 'mention_removed'
  if (!item.isMember) return 'not_member'
  if (!item.wantsMentions) return 'preference_off'
  if (item.authorId === userId) return 'self'
  return null
}

export function recipientSkipReason(recipient: RecipientRow | null, kind: OutboxKind): string | null {
  if (!recipient?.email) return 'no_recipient'
  if (!recipient.email_confirmed) return 'unconfirmed'
  if (!isValidEmailAddress(recipient.email)) return 'invalid_recipient'
  if (recipient.suppressed) return 'suppressed'
  if (kind === 'broadcast') return recipient.email_marketing_enabled === false ? 'preference_off' : null
  if (kind === 'task_reminder' || kind === 'workspace_task_reminder') {
    return recipient.email_reminders_enabled === false ? 'preference_off' : null
  }
  if (recipient.email_workspace_enabled === false) return 'preference_off'
  return null
}

export function updatedSkipReason(item: AssignedItem | null, userId: string): string | null {
  if (!item) return 'not_found'
  if (item.assigneeId !== userId) return 'reassigned'
  if (!item.isMember) return 'not_member'
  if (!item.wantsTaskUpdates) return 'preference_off'
  return null
}

export function workspaceReminderSkipReason(item: AssignedItem | null, userId: string, now: number): string | null {
  if (!item) return 'not_found'
  if ((item.assigneeId ?? item.createdBy) !== userId) return 'reassigned'
  if (!item.isMember) return 'not_member'
  if (CLOSED.has(item.status)) return 'task_closed'
  if (!item.reminderAt || now - ms(item.reminderAt) > REMINDER_STALE_MS) return 'stale'
  return null
}

type Changes = TaskUpdate['changes']

/** Validates the trigger's change record and merges several updates of one task. */
export function mergeChanges(list: unknown[]): Changes {
  const out: Changes = {}
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    for (const field of ['status', 'priority'] as const) {
      const v = c[field] as { from?: unknown; to?: unknown } | undefined
      if (v && typeof v.from === 'string' && typeof v.to === 'string') {
        out[field] = { from: out[field]?.from ?? v.from.slice(0, 32), to: v.to.slice(0, 32) }
      }
    }
    if (c.due === true) out.due = true
    if (c.title === true) out.title = true
    if (c.comment === true) out.comment = true
  }
  if (out.status && out.status.from === out.status.to) delete out.status
  if (out.priority && out.priority.from === out.priority.to) delete out.priority
  return out
}

const MENTION_TOKEN = /@\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}/gi

export function mentionSnippet(content: string, names: Map<string, string>) {
  return content.replace(MENTION_TOKEN, (_, id: string) => `@${names.get(id.toLowerCase()) ?? 'member'}`)
}

export function mentionIds(content: string) {
  return [...new Set([...content.matchAll(MENTION_TOKEN)].map((m) => m[1]!.toLowerCase()))]
}

const taskRef = (key: string | null, n: number | null) => (key && n != null ? `${key}-${n}` : null)
const dateString = (value: string | Date | null) =>
  value == null ? null : value instanceof Date ? value.toISOString() : value

export type DrainResult = { batches: number; sent: number; skipped: number; retried: number; failed: number }

type Context = {
  store: OutboxStore
  service: EmailService
  config: EmailConfig
  now: () => number
  log: EmailLogger
}

type Prepared = { email: RenderedEmail; ids: string[]; headers?: Record<string, string> } | null

/** Group keys include the workspace, so a mixed batch means corrupted data; never mix workspaces. */
async function keepWorkspace<T extends { row: OutboxRow; item: { workspaceId: string } }>(
  valid: T[],
  workspaceId: string,
  skip: (row: OutboxRow, reason: string) => Promise<void>,
) {
  const kept: T[] = []
  for (const entry of valid) {
    if (entry.item.workspaceId === workspaceId) kept.push(entry)
    else await skip(entry.row, 'workspace_mismatch')
  }
  return kept
}

async function prepareBatch(batch: Batch, recipient: RecipientRow, ctx: Context): Promise<Prepared> {
  const { store, config } = ctx
  const fmt: Recipient = {
    locale: normalizeLocale(recipient.locale),
    timeZone: safeTimeZone(recipient.time_zone),
    timeFormat: recipient.time_format === '12h' ? '12h' : '24h',
  }
  const skip = async (row: OutboxRow, reason: string) => {
    await store.markSkipped([row.id], reason)
    ctx.log('email.outbox', { outcome: 'skipped', code: reason, outboxIds: [row.id] })
  }
  const drop = async (row: OutboxRow, reason: string): Promise<Prepared> => {
    await skip(row, reason)
    return null
  }

  if (batch.kind === 'task_reminder') {
    // Reminders are never grouped; one row per batch.
    const row = batch.rows[0]!
    for (const extra of batch.rows.slice(1)) await skip(extra, 'duplicate')
    const reminderId = row.payload.reminder_id
    const item = isUuid(reminderId) ? await store.loadTaskReminder(reminderId, row.user_id) : null
    const reason = reminderSkipReason(item, ctx.now())
    if (reason || !item) {
      await skip(row, reason ?? 'not_found')
      return null
    }
    return {
      ids: [row.id],
      email: taskReminderEmail({
        locale: fmt.locale,
        appBaseUrl: config.appBaseUrl,
        recipientName: recipient.display_name,
        taskId: item.taskId,
        taskTitle: item.title,
        projectName: item.projectName,
        priority: item.priority,
        dueLabel: formatDue({ dueAt: dateString(item.dueAt), dueDate: item.dueDate, dueTime: item.dueTime }, fmt),
      }),
    }
  }

  if (batch.kind === 'broadcast') {
    const row = batch.rows[0]!
    for (const extra of batch.rows.slice(1)) await skip(extra, 'duplicate')
    const broadcastId = row.payload.broadcast_id
    const item = isUuid(broadcastId) ? await store.loadBroadcast(broadcastId) : null
    if (!item) return drop(row, 'not_found')
    if (ctx.now() - ms(item.createdAt) > BROADCAST_STALE_MS) return drop(row, 'stale')
    if (!config.unsubscribeSecret) return drop(row, 'not_configured')
    const content = item.content[fmt.locale] ?? item.content.en ?? item.content.ar
    if (!content) return drop(row, 'no_content')
    const unsubscribe = unsubscribeUrl(config.appBaseUrl, config.unsubscribeSecret, row.user_id)
    return {
      ids: [row.id],
      email: broadcastEmail({ locale: fmt.locale, appBaseUrl: config.appBaseUrl, content, unsubscribeUrl: unsubscribe }),
      headers: {
        'List-Unsubscribe': `<${unsubscribe}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }
  }

  if (batch.kind === 'workspace_task_reminder') {
    const row = batch.rows[0]!
    for (const extra of batch.rows.slice(1)) await skip(extra, 'duplicate')
    const taskId = row.payload.task_id
    const item = isUuid(taskId) ? await store.loadAssignedTask(taskId, row.user_id) : null
    const reason = workspaceReminderSkipReason(item, row.user_id, ctx.now())
    if (reason || !item) return drop(row, reason ?? 'not_found')
    return {
      ids: [row.id],
      email: workspaceTaskReminderEmail({
        locale: fmt.locale,
        appBaseUrl: config.appBaseUrl,
        workspaceId: item.workspaceId,
        workspaceName: item.workspaceName,
        taskId: item.taskId,
        ref: taskRef(item.taskKey, item.taskNumber),
        title: item.title,
        priority: item.priority,
        dueLabel: formatDue({ dueAt: dateString(item.dueAt), dueDate: item.dueDate }, fmt),
      }),
    }
  }

  const fresh: OutboxRow[] = []
  for (const row of batch.rows) {
    if (ctx.now() - ms(row.created_at) > WORKSPACE_STALE_MS) await skip(row, 'stale')
    else fresh.push(row)
  }

  if (batch.kind === 'workspace_task_updated') {
    const byTask = new Map<string, { item: AssignedItem; rows: OutboxRow[] }>()
    for (const row of fresh) {
      const taskId = row.payload.task_id
      const cached = isUuid(taskId) ? byTask.get(taskId) : undefined
      const item = cached?.item ?? (isUuid(taskId) ? await store.loadAssignedTask(taskId, row.user_id) : null)
      const reason = updatedSkipReason(item, row.user_id)
      if (reason || !item) await skip(row, reason ?? 'not_found')
      else if (cached) cached.rows.push(row)
      else byTask.set(item.taskId, { item, rows: [row] })
    }
    const groups = await keepWorkspace(
      [...byTask.values()].map((g) => ({ row: g.rows[0]!, item: g.item, rows: g.rows })),
      [...byTask.values()][0]?.item.workspaceId ?? '',
      skip,
    )
    if (!groups.length) return null
    const actorIds = new Set<string>()
    for (const g of groups) for (const r of g.rows) if (isUuid(r.payload.actor_id)) actorIds.add(r.payload.actor_id)
    const workspace = groups[0]!.item
    const names = await store.displayNames(workspace.workspaceId, [...actorIds])
    const updates: TaskUpdate[] = []
    for (const g of groups) {
      const changes = mergeChanges(g.rows.map((r) => r.payload.changes))
      let commentSnippet: string | null = null
      const commentRow = [...g.rows].reverse().find((r) => isUuid(r.payload.comment_id))
      if (changes.comment && commentRow) {
        const comment = await store.loadComment(commentRow.payload.comment_id as string)
        if (comment && comment.taskId === g.item.taskId) commentSnippet = mentionSnippet(comment.content, names)
        else delete changes.comment
      }
      if (!Object.keys(changes).length) continue
      const actors = new Set(g.rows.map((r) => r.payload.actor_id).filter(isUuid))
      const actorId = actors.size === 1 ? [...actors][0]! : null
      updates.push({
        taskId: g.item.taskId,
        ref: taskRef(g.item.taskKey, g.item.taskNumber),
        title: g.item.title,
        actorName: actorId ? (names.get(actorId.toLowerCase()) ?? null) : null,
        changes,
        dueLabel: formatDue({ dueAt: dateString(g.item.dueAt), dueDate: g.item.dueDate }, fmt),
        commentSnippet,
      })
    }
    const ids = groups.flatMap((g) => g.rows.map((r) => r.id))
    if (!updates.length) {
      await store.markSkipped(ids, 'no_changes')
      return null
    }
    return {
      ids,
      email: workspaceTaskUpdatesEmail({
        locale: fmt.locale,
        appBaseUrl: config.appBaseUrl,
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        updates,
      }),
    }
  }

  if (batch.kind === 'workspace_task_assigned') {
    const valid: Array<{ row: OutboxRow; item: AssignedItem }> = []
    for (const row of fresh) {
      const taskId = row.payload.task_id
      const item = isUuid(taskId) ? await store.loadAssignedTask(taskId, row.user_id) : null
      const reason = assignedSkipReason(item, row.user_id)
      // The same task can be assigned, unassigned and re-assigned inside one digest window.
      if (!reason && item && valid.some((v) => v.item.taskId === item.taskId)) await skip(row, 'duplicate')
      else if (reason || !item) await skip(row, reason ?? 'not_found')
      else valid.push({ row, item })
    }
    if (!valid.length) return null
    const workspace = valid[0]!.item
    const sameWorkspace = await keepWorkspace(valid, workspace.workspaceId, skip)
    const actors = new Set(sameWorkspace.map((v) => v.row.payload.actor_id))
    const actorId = actors.size === 1 ? [...actors][0] : null
    const names = isUuid(actorId) ? await store.displayNames(workspace.workspaceId, [actorId]) : new Map()
    return {
      ids: sameWorkspace.map((v) => v.row.id),
      email: workspaceTaskAssignedEmail({
        locale: fmt.locale,
        appBaseUrl: config.appBaseUrl,
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        actorName: isUuid(actorId) ? (names.get(actorId) ?? null) : null,
        tasks: sameWorkspace.map(({ item }) => ({
          taskId: item.taskId,
          ref: taskRef(item.taskKey, item.taskNumber),
          title: item.title,
          dueLabel: formatDue({ dueAt: dateString(item.dueAt), dueDate: item.dueDate }, fmt),
        })),
      }),
    }
  }

  const valid: Array<{ row: OutboxRow; item: MentionItem }> = []
  for (const row of fresh) {
    const commentId = row.payload.comment_id
    const item = isUuid(commentId) ? await store.loadMention(commentId, row.user_id) : null
    const reason = mentionSkipReason(item, row.user_id)
    if (reason || !item) await skip(row, reason ?? 'not_found')
    else valid.push({ row, item })
  }
  if (!valid.length) return null
  const workspace = valid[0]!.item
  const sameWorkspace = await keepWorkspace(valid, workspace.workspaceId, skip)
  const people = new Set<string>()
  for (const { item } of sameWorkspace) {
    people.add(item.authorId.toLowerCase())
    for (const id of mentionIds(item.content)) people.add(id)
  }
  const names = await store.displayNames(workspace.workspaceId, [...people])
  return {
    ids: sameWorkspace.map((v) => v.row.id),
    email: workspaceMentionEmail({
      locale: fmt.locale,
      appBaseUrl: config.appBaseUrl,
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      mentions: sameWorkspace.map(({ item }) => ({
        commentId: item.commentId,
        taskId: item.taskId,
        taskRef: taskRef(item.taskKey, item.taskNumber) ?? item.taskTitle,
        authorName: names.get(item.authorId.toLowerCase()) ?? (fmt.locale === 'ar' ? 'أحد الأعضاء' : 'Someone'),
        snippet: mentionSnippet(item.content, names),
      })),
    }),
  }
}

async function settle(batchIds: string[], result: SendResult, attempts: number, ctx: Context, out: DrainResult) {
  if (result.ok) {
    await ctx.store.markSent(batchIds, result.id)
    out.sent += 1
    return
  }
  if (result.code === 'invalid_recipient' || result.code === 'not_configured') {
    await ctx.store.markSkipped(batchIds, result.code)
    out.skipped += 1
    return
  }
  const delay = result.retryable ? retryDelaySeconds(attempts) : null
  if (delay != null) {
    await ctx.store.scheduleRetry(batchIds, delay, result.code)
    out.retried += 1
  } else {
    await ctx.store.markFailed(batchIds, result.code)
    out.failed += 1
  }
  ctx.log('email.outbox', {
    outcome: delay != null ? 'retry' : 'failed',
    code: result.code,
    attempts,
    outboxIds: batchIds,
  })
}

export async function drainOutbox(
  deps: { store: OutboxStore; service: EmailService; config: EmailConfig; now?: () => number; log?: EmailLogger },
  options: { limit?: number; budgetMs?: number; kinds?: OutboxKind[] | null; paceMs?: number } = {},
): Promise<DrainResult> {
  const ctx: Context = {
    store: deps.store,
    service: deps.service,
    config: deps.config,
    now: deps.now ?? Date.now,
    log: deps.log ?? logEmail,
  }
  const started = ctx.now()
  const budget = options.budgetMs ?? 20_000
  const pace = options.paceMs ?? 600
  const out: DrainResult = { batches: 0, sent: 0, skipped: 0, retried: 0, failed: 0 }

  const rows = await ctx.store.claimDue(options.limit ?? 25, options.kinds ?? null)
  if (!rows.length) return out

  if (!ctx.service.enabled) {
    // Without a configured provider nothing is sent; drop instead of delivering late later.
    await ctx.store.markSkipped(rows.map((r) => r.id), 'not_configured')
    ctx.log('email.outbox', { outcome: 'disabled', code: 'not_configured', items: rows.length })
    out.skipped += rows.length
    return out
  }

  const batches = planBatches(rows)
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]!
    const ids = batch.rows.map((r) => r.id)
    if (ctx.now() - started > budget) {
      await ctx.store.release(batches.slice(i).flatMap((b) => b.rows.map((r) => r.id)))
      break
    }
    out.batches += 1
    try {
      if (batch.isNew) await ctx.store.assignBatch(batch.key, ids)
      const recipient = await ctx.store.loadRecipient(batch.userId)
      const reason = recipientSkipReason(recipient, batch.kind)
      if (reason || !recipient) {
        await ctx.store.markSkipped(ids, reason ?? 'no_recipient')
        ctx.log('email.outbox', { outcome: 'skipped', code: reason ?? 'no_recipient', outboxIds: ids })
        out.skipped += 1
        continue
      }
      const prepared = await prepareBatch(batch, recipient, ctx)
      if (!prepared) {
        out.skipped += 1
        continue
      }
      const attempts = Math.max(...batch.rows.map((r) => r.attempts))
      const result = await ctx.service.send({
        category: prepared.email.category,
        template: prepared.email.template,
        to: recipient.email!,
        subject: prepared.email.subject,
        html: prepared.email.html,
        text: prepared.email.text,
        headers: prepared.headers,
        idempotencyKey: idempotencyKeyFor(batch),
      })
      await settle(prepared.ids, result, attempts, ctx, out)
      if (pace > 0 && i < batches.length - 1) await new Promise((r) => setTimeout(r, pace))
    } catch {
      // Unexpected (database) error for this batch: put it back with the normal retry schedule.
      const attempts = Math.max(...batch.rows.map((r) => r.attempts))
      const delay = retryDelaySeconds(attempts)
      if (delay != null) await ctx.store.scheduleRetry(ids, delay, 'internal_error').catch(() => undefined)
      else await ctx.store.markFailed(ids, 'internal_error').catch(() => undefined)
      ctx.log('email.outbox', { outcome: delay != null ? 'retry' : 'failed', code: 'internal_error', outboxIds: ids })
      out.failed += delay == null ? 1 : 0
      out.retried += delay != null ? 1 : 0
    }
  }
  return out
}
