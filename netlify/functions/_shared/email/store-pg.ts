/** Postgres implementation of the outbox store (service connection; private schema). */
import type pg from 'pg'
import type { AssignedItem, MentionItem, OutboxKind, OutboxRow, OutboxStore, RecipientRow, ReminderItem } from './outbox.ts'

type Queryable = Pick<pg.Client, 'query'>

const ROW_COLUMNS = 'id, kind, user_id, payload, group_key, batch_key, attempts, created_at'

export function createPgOutboxStore(db: Queryable): OutboxStore {
  return {
    async claimDue(limit, kinds) {
      const { rows } = await db.query<OutboxRow>(
        `with due as (
           select id from private.email_outbox
           where ((status = 'pending' and send_after <= now())
               or (status = 'sending' and locked_at < now() - interval '10 minutes'))
             and ($2::text[] is null or kind = any($2::text[]))
           order by send_after
           limit $1
           for update skip locked
         )
         update private.email_outbox o
         set status = 'sending', locked_at = now(), attempts = o.attempts + 1, updated_at = now()
         from due where o.id = due.id
         returning ${ROW_COLUMNS.split(', ').map((c) => `o.${c}`).join(', ')}`,
        [limit, kinds],
      )
      const groups = [...new Set(rows.filter((r) => r.group_key && !r.batch_key).map((r) => r.group_key!))]
      if (!groups.length) return rows
      // Pull in not-yet-due siblings of the same digest so one burst becomes one email.
      const siblings = await db.query<OutboxRow>(
        `with sib as (
           select id from private.email_outbox
           where status = 'pending' and batch_key is null and group_key = any($1::text[])
           for update skip locked
         )
         update private.email_outbox o
         set status = 'sending', locked_at = now(), attempts = o.attempts + 1, updated_at = now()
         from sib where o.id = sib.id
         returning ${ROW_COLUMNS.split(', ').map((c) => `o.${c}`).join(', ')}`,
        [groups],
      )
      return [...rows, ...siblings.rows]
    },

    async loadRecipient(userId) {
      const { rows } = await db.query<RecipientRow>(
        `select u.email,
                (u.email_confirmed_at is not null) as email_confirmed,
                nullif(btrim(p.display_name), '') as display_name,
                s.locale, s.time_zone, s.time_format,
                s.email_reminders_enabled, s.email_workspace_enabled,
                exists (select 1 from private.email_suppressions x where x.email = lower(u.email)) as suppressed
         from auth.users u
         left join public.profiles p on p.id = u.id
         left join public.user_settings s on s.user_id = u.id
         where u.id = $1 and u.deleted_at is null`,
        [userId],
      )
      return rows[0] ?? null
    },

    async loadTaskReminder(reminderId, userId) {
      const { rows } = await db.query<ReminderItem>(
        `select r.remind_at as "remindAt", t.id as "taskId", t.title, t.status::text as status,
                t.priority::text as priority, t.due_at as "dueAt", t.due_date::text as "dueDate",
                t.due_time::text as "dueTime", p.name as "projectName", pref.email_reminders as "projectEmail"
         from public.task_reminders r
         join public.tasks t on t.id = r.task_id and t.user_id = r.user_id
         join public.projects p on p.id = r.project_id and p.user_id = r.user_id
         left join public.project_notification_prefs pref
           on pref.user_id = r.user_id and pref.project_id = r.project_id
         where r.id = $1 and r.user_id = $2`,
        [reminderId, userId],
      )
      return rows[0] ?? null
    },

    async loadAssignedTask(taskId, userId) {
      const { rows } = await db.query<AssignedItem>(
        `select t.id as "taskId", t.title, t.task_number as "taskNumber", t.status::text as status,
                t.due_at as "dueAt", t.due_date::text as "dueDate", t.assignee_id as "assigneeId",
                w.id as "workspaceId", w.name as "workspaceName", w.task_key as "taskKey",
                exists (select 1 from public.workspace_members m
                        where m.workspace_id = t.workspace_id and m.user_id = $2) as "isMember",
                private.wants_workspace_mentions(t.workspace_id, $2) as "wantsMentions"
         from public.workspace_tasks t
         join public.workspaces w on w.id = t.workspace_id
         where t.id = $1`,
        [taskId, userId],
      )
      return rows[0] ?? null
    },

    async loadMention(commentId, userId) {
      const { rows } = await db.query<MentionItem>(
        `select c.id as "commentId", c.content, c.author_user_id as "authorId",
                t.id as "taskId", t.title as "taskTitle", t.task_number as "taskNumber",
                w.id as "workspaceId", w.name as "workspaceName", w.task_key as "taskKey",
                exists (select 1 from public.workspace_comment_mentions m
                        where m.comment_id = c.id and m.mentioned_user_id = $2) as "mentionExists",
                exists (select 1 from public.workspace_members m
                        where m.workspace_id = c.workspace_id and m.user_id = $2) as "isMember",
                private.wants_workspace_mentions(c.workspace_id, $2) as "wantsMentions"
         from public.workspace_task_comments c
         join public.workspace_tasks t on t.id = c.task_id and t.workspace_id = c.workspace_id
         join public.workspaces w on w.id = c.workspace_id
         where c.id = $1`,
        [commentId, userId],
      )
      return rows[0] ?? null
    },

    async displayNames(workspaceId, userIds) {
      if (!userIds.length) return new Map()
      const { rows } = await db.query<{ id: string; name: string | null }>(
        `select p.id::text as id,
                coalesce(nullif(btrim(ms.display_name_override), ''), nullif(btrim(p.display_name), '')) as name
         from public.profiles p
         join public.workspace_members m on m.user_id = p.id and m.workspace_id = $1
         left join public.workspace_member_settings ms on ms.user_id = p.id and ms.workspace_id = $1
         where p.id = any($2::uuid[])`,
        [workspaceId, userIds],
      )
      return new Map(rows.filter((r) => r.name).map((r) => [r.id.toLowerCase(), r.name!]))
    },

    async assignBatch(batchKey, ids) {
      await db.query(
        `update private.email_outbox set batch_key = $1, updated_at = now() where id = any($2::uuid[]) and batch_key is null`,
        [batchKey, ids],
      )
    },

    async markSent(ids, messageId) {
      await db.query(
        `update private.email_outbox
         set status = 'sent', provider_message_id = $2, locked_at = null, last_error = null, updated_at = now()
         where id = any($1::uuid[])`,
        [ids, messageId],
      )
    },

    async markSkipped(ids, reason) {
      await db.query(
        `update private.email_outbox
         set status = 'skipped', last_error = left($2, 64), locked_at = null, updated_at = now()
         where id = any($1::uuid[])`,
        [ids, reason],
      )
    },

    async scheduleRetry(ids, delaySeconds, code) {
      await db.query(
        `update private.email_outbox
         set status = 'pending', send_after = now() + make_interval(secs => $2), locked_at = null,
             last_error = left($3, 64), updated_at = now()
         where id = any($1::uuid[])`,
        [ids, delaySeconds, code],
      )
    },

    async markFailed(ids, code) {
      await db.query(
        `update private.email_outbox
         set status = 'failed', last_error = left($2, 64), locked_at = null, updated_at = now()
         where id = any($1::uuid[])`,
        [ids, code],
      )
    },

    async release(ids) {
      if (!ids.length) return
      await db.query(
        `update private.email_outbox
         set status = 'pending', attempts = greatest(attempts - 1, 0), locked_at = null, updated_at = now()
         where id = any($1::uuid[]) and status = 'sending'`,
        [ids],
      )
    },
  }
}

/** Queue a personal task reminder email (idempotent per reminder). */
export async function enqueueTaskReminderEmail(db: Queryable, input: { reminderId: string; userId: string }) {
  const kind: OutboxKind = 'task_reminder'
  await db.query(
    `insert into private.email_outbox (kind, user_id, dedupe_key, payload)
     values ($1, $2, $3, jsonb_build_object('reminder_id', $4::uuid))
     on conflict (dedupe_key) do nothing`,
    [kind, input.userId, `task-reminder/${input.reminderId}`, input.reminderId],
  )
}
