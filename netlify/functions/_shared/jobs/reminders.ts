import type pg from 'pg'
import webpush from 'web-push'
import { claimDueReminders } from '../reminder-claims.ts'
import { loadEmailConfig } from '../email/config.ts'
import { drainOutbox } from '../email/outbox.ts'
import { createEmailService } from '../email/service.ts'
import { createPgOutboxStore, enqueueTaskReminderEmail, processWorkspaceTaskReminders } from '../email/store-pg.ts'

type ReminderRow = {
  id: string
  user_id: string
  task_id: string
  project_id: string
  remind_at: string
  channels: string[] | null
  task_title: string
  task_priority: string
  task_status: string
  task_due_at: string | null
  task_due_date: string | null
  task_due_time: string | null
  project_name: string
  email_reminders_enabled: boolean | null
  push_notifications_enabled: boolean | null
  project_email: boolean | null
  project_push: boolean | null
  project_in_app: boolean | null
}

function formatDue(row: ReminderRow) {
  if (row.task_due_at) {
    try {
      return new Date(row.task_due_at).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return row.task_due_at
    }
  }
  if (row.task_due_date) {
    return row.task_due_time ? `${row.task_due_date} at ${row.task_due_time}` : row.task_due_date
  }
  return 'No due date'
}

export async function loadReminderSecrets(client: pg.PoolClient) {
  const { rows } = await client.query<{ key: string; value: string }>(
    `select key, value from private.server_secrets
     where key in ('VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','APP_URL','CRON_SECRET')`,
  )
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>
}

/** Personal and workspace task reminders due in the next minute (push, in-app, email). */
export async function runTaskReminders(client: pg.PoolClient, secrets: Record<string, string>) {
  let pushed = 0
  let processed = 0
  let emailQueued = 0

  const vapidPublic = process.env.VAPID_PUBLIC_KEY || secrets.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY || secrets.VAPID_PRIVATE_KEY
  const vapidSubject = process.env.VAPID_SUBJECT || secrets.VAPID_SUBJECT || 'mailto:noreply@hillm.netlify.app'
  const appUrl = (process.env.APP_URL || secrets.APP_URL || process.env.VITE_APP_URL || 'https://app.hilm.tech').replace(/\/$/, '')

  if (!vapidPublic || !vapidPrivate) {
    throw new Error('VAPID keys missing (env or private.server_secrets)')
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  const windowEnd = new Date(Date.now() + 60_000).toISOString()
  const claimedIds = await claimDueReminders(client, windowEnd)
  const { rows } = await client.query<ReminderRow>(
    `
    select
      r.id, r.user_id, r.task_id, r.project_id, r.remind_at, r.channels,
      t.title as task_title, t.priority as task_priority, t.status as task_status,
      t.due_at as task_due_at, t.due_date as task_due_date, t.due_time as task_due_time,
      p.name as project_name,
      s.email_reminders_enabled, s.push_notifications_enabled,
      pref.email_reminders as project_email,
      pref.push_notifications as project_push,
      pref.in_app_notifications as project_in_app
    from public.task_reminders r
    join public.tasks t on t.id = r.task_id
    join public.projects p on p.id = r.project_id
    left join public.user_settings s on s.user_id = r.user_id
    left join public.project_notification_prefs pref
      on pref.user_id = r.user_id and pref.project_id = r.project_id
    where r.id = any($1::uuid[])
    order by r.remind_at asc
    `,
    [claimedIds],
  )

  for (const row of rows) {
    processed += 1
    if (row.task_status === 'done' || row.task_status === 'archived') {
      await client.query(
        `update public.task_reminders
         set notification_sent = true, sent_at = now(),
             metadata = coalesce(metadata,'{}'::jsonb) || '{"skipped":"task_closed"}'::jsonb
         where id = $1`,
        [row.id],
      )
      continue
    }

    const channels = row.channels?.length ? row.channels : ['push', 'in_app']
    const dueLabel = formatDue(row)
    const taskHref = `/app/tasks/${row.task_id}`

    // Live prefs win over the channels snapshot (toggle/save often lagged behind creates).
    const inAppAllowed = row.project_in_app !== false
    const pushPrefOn = row.push_notifications_enabled === true || channels.includes('push')
    const pushCandidate = pushPrefOn && row.project_push !== false

    const subs = pushCandidate
      ? await client.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
          `select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = $1`,
          [row.user_id],
        )
      : { rows: [] as Array<{ id: string; endpoint: string; p256dh: string; auth: string }> }

    const pushAllowed = pushCandidate && subs.rows.length > 0

    if (pushAllowed) {
      const payload = JSON.stringify({
        title: `Reminder | ${row.task_title}`,
        body: `${row.project_name} · Due ${dueLabel}`,
        href: taskHref,
        tag: `task-${row.task_id}`,
      })

      for (const sub of subs.rows) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
          pushed += 1
        } catch (error) {
          const statusCode =
            error && typeof error === 'object' && 'statusCode' in error ? Number((error as { statusCode?: number }).statusCode) : 0
          if (statusCode === 404 || statusCode === 410) {
            await client.query(`delete from public.push_subscriptions where id = $1`, [sub.id])
          }
        }
      }
    }

    // Email goes through the outbox (one per reminder); the dispatcher re-checks preferences.
    const emailAllowed = row.email_reminders_enabled !== false && row.project_email !== false
    if (emailAllowed) {
      try {
        await enqueueTaskReminderEmail(client, { reminderId: row.id, userId: row.user_id })
        emailQueued += 1
      } catch {
        // Email is best effort; the reminder itself (push/in-app) must still complete.
      }
    }

    // Always create an in-app row unless the project muted in-app notifications.
    if (inAppAllowed) {
      await client.query(
        `insert into public.notifications
          (user_id, channel, type, title, body, entity_type, entity_id, project_id, href, metadata)
         values ($1, $2, 'task_reminder', $3, $4, 'task', $5, $6, $7, $8::jsonb)`,
        [
          row.user_id,
          pushAllowed ? 'push' : 'in_app',
          `Reminder | ${row.task_title}`,
          `${row.project_name} · Due ${dueLabel}`,
          row.task_id,
          row.project_id,
          taskHref,
          JSON.stringify({
            reminder_id: row.id,
            task_title: row.task_title,
            due_label: dueLabel,
            project_name: row.project_name,
            push: pushAllowed,
            push_attempted: pushCandidate,
            push_subs: subs.rows.length,
          }),
        ],
      )
    }

    await client.query(`update public.task_reminders set notification_sent = true, sent_at = now() where id = $1`, [row.id])
    await client.query(`update public.tasks set notification_sent = true, reminder_datetime = $2 where id = $1`, [
      row.task_id,
      row.remind_at,
    ])
    await client.query(
      `insert into public.activity_events
        (user_id, entity_type, entity_id, project_id, action, summary, metadata)
       values ($1, 'task', $2, $3, 'reminder_sent', $4, $5::jsonb)`,
      [
        row.user_id,
        row.task_id,
        row.project_id,
        `Reminder sent for "${row.task_title}"`,
        JSON.stringify({ reminder_id: row.id, channels, push: pushAllowed, email: emailAllowed, app_url: appUrl }),
      ],
    )
  }

  let workspaceReminders = { due: 0, queued: 0 }
  try {
    workspaceReminders = await processWorkspaceTaskReminders(client, windowEnd)
  } catch {
    // Workspace reminders are independent of personal ones; retried next minute.
  }

  return { processed, pushed, emailQueued, workspaceReminders }
}

/** Sends queued transactional email within a time budget. */
export async function drainEmail(client: pg.PoolClient, budgetMs: number, limit = 25) {
  const config = loadEmailConfig()
  const result = await drainOutbox(
    { store: createPgOutboxStore(client), service: createEmailService(config), config },
    { limit, budgetMs },
  )
  return { enabled: Boolean(config.apiKey) && !config.problems.length, ...result }
}
