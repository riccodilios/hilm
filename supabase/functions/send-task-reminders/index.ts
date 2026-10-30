import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ReminderRow = {
  id: string
  user_id: string
  task_id: string
  project_id: string
  remind_at: string
  reminder_type: string
  channels: string[]
  tasks: {
    id: string
    title: string
    priority: string
    due_at: string | null
    due_date: string | null
    due_time: string | null
    status: string
  }
  projects: {
    id: string
    name: string
    color: string
  }
}

// Legacy fallback: push + in-app only. Reminder email is sent by the Netlify reminder job through
// the email outbox (one idempotent email per reminder); sending here as well would duplicate it.

function formatDue(task: ReminderRow['tasks']) {
  if (task.due_at) {
    try {
      return new Date(task.due_at).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return task.due_at
    }
  }
  if (task.due_date) {
    return task.due_time ? `${task.due_date} at ${task.due_time}` : task.due_date
  }
  return 'No due date'
}

function configureWebPush() {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@hillm.netlify.app'
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  return true
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (!cronSecret?.trim()) {
      return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500, headers: corsHeaders })
    }
    const provided =
      request.headers.get('x-cron-secret') ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      new URL(request.url).searchParams.get('cron_secret') ||
      ''
    if (provided !== cronSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
    }

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const webPushReady = configureWebPush()
    const admin = createClient(url, serviceKey)
    const now = new Date()
    const windowEnd = new Date(now.getTime() + 60_000).toISOString()

    const { data: dueReminders, error } = await admin
      .from('task_reminders')
      .select(`
        id, user_id, task_id, project_id, remind_at, reminder_type, channels,
        tasks!inner ( id, title, priority, due_at, due_date, due_time, status ),
        projects!inner ( id, name, color )
      `)
      .eq('notification_sent', false)
      .lte('remind_at', windowEnd)
      .limit(100)

    if (error) throw error

    let pushed = 0

    for (const raw of dueReminders ?? []) {
      const reminder = raw as unknown as ReminderRow
      if (reminder.tasks.status === 'done' || reminder.tasks.status === 'archived') {
        await admin.from('task_reminders').update({
          notification_sent: true,
          sent_at: new Date().toISOString(),
          metadata: { skipped: 'task_closed' },
        }).eq('id', reminder.id)
        continue
      }

      const { data: settings } = await admin
        .from('user_settings')
        .select('email_reminders_enabled, push_notifications_enabled')
        .eq('user_id', reminder.user_id)
        .maybeSingle()

      const { data: projectPref } = await admin
        .from('project_notification_prefs')
        .select('email_reminders, push_notifications, in_app_notifications')
        .eq('user_id', reminder.user_id)
        .eq('project_id', reminder.project_id)
        .maybeSingle()

      const taskHref = `/app/tasks/${reminder.task_id}`
      const dueLabel = formatDue(reminder.tasks)
      const channels = reminder.channels?.length ? reminder.channels : ['email', 'in_app']

      const inAppAllowed =
        channels.includes('in_app') && projectPref?.in_app_notifications !== false

      const pushAllowed =
        channels.includes('push') &&
        settings?.push_notifications_enabled === true &&
        projectPref?.push_notifications !== false

      if (pushAllowed && webPushReady) {
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth')
          .eq('user_id', reminder.user_id)

        const payload = JSON.stringify({
          title: `Reminder — ${reminder.tasks.title}`,
          body: `${reminder.projects.name} · Due ${dueLabel}`,
          href: taskHref,
          tag: `task-${reminder.task_id}`,
        })

        for (const sub of subs ?? []) {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              payload,
            )
            pushed += 1
          } catch (pushError) {
            const statusCode =
              pushError && typeof pushError === 'object' && 'statusCode' in pushError
                ? Number((pushError as { statusCode?: number }).statusCode)
                : 0
            if (statusCode === 404 || statusCode === 410) {
              await admin.from('push_subscriptions').delete().eq('id', sub.id)
            } else {
              console.error('push failed', pushError)
            }
          }
        }
      }

      if (inAppAllowed || pushAllowed) {
        await admin.from('notifications').insert({
          user_id: reminder.user_id,
          channel: pushAllowed ? 'push' : 'in_app',
          type: 'task_reminder',
          title: `Reminder — ${reminder.tasks.title}`,
          body: `${reminder.projects.name} · Due ${dueLabel}`,
          entity_type: 'task',
          entity_id: reminder.task_id,
          project_id: reminder.project_id,
          href: taskHref,
          metadata: {
            reminder_id: reminder.id,
            push: pushAllowed,
          },
        })
      }

      await admin.from('task_reminders').update({
        notification_sent: true,
        sent_at: new Date().toISOString(),
      }).eq('id', reminder.id)

      await admin.from('tasks').update({
        notification_sent: true,
        reminder_datetime: reminder.remind_at,
      }).eq('id', reminder.task_id)

      const channelSummary = [
        pushAllowed ? 'push' : null,
        inAppAllowed ? 'in_app' : null,
      ].filter(Boolean).join(', ')

      await admin.from('activity_events').insert({
        user_id: reminder.user_id,
        entity_type: 'task',
        entity_id: reminder.task_id,
        project_id: reminder.project_id,
        action: 'reminder_sent',
        summary: `Reminder sent for "${reminder.tasks.title}"${channelSummary ? ` (${channelSummary})` : ''}`,
        metadata: {
          reminder_id: reminder.id,
          channels,
          pushed: pushAllowed,
        },
      })
    }

    return Response.json(
      { ok: true, processed: dueReminders?.length ?? 0, pushed },
      { headers: corsHeaders },
    )
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Reminder job failed' },
      { status: 500, headers: corsHeaders },
    )
  }
})
