import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

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

function buildEmail(input: {
  userName: string
  projectName: string
  projectColor: string
  taskTitle: string
  priority: string
  dueLabel: string
  openUrl: string
  appUrl: string
}) {
  const subject = `Task Reminder — ${input.taskTitle}`
  const text = `Hi${input.userName ? ` ${input.userName}` : ''},\n\nThis is a reminder that you have an upcoming task.\n\nProject: ${input.projectName}\nTask: ${input.taskTitle}\nPriority: ${input.priority}\nDue: ${input.dueLabel}\n\nOpen task: ${input.openUrl}`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="color-scheme" content="light dark"/><style>
body{margin:0;background:#0a0a0b;color:#f4f4f5;font-family:ui-sans-serif,system-ui,sans-serif}
.card{max-width:560px;margin:32px auto;background:#111113;border:1px solid #27272a;border-radius:20px;padding:28px}
.brand{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa;margin-bottom:16px}
h1{font-size:22px;margin:0 0 10px;color:#fafafa}
p{color:#a1a1aa;line-height:1.6}
.row{display:flex;gap:12px;padding:12px 0;border-top:1px solid #1c1c1f}
.label{width:88px;color:#71717a;font-size:13px}.value{color:#f4f4f5;font-size:14px;font-weight:500}
.dot{display:inline-block;width:8px;height:8px;border-radius:99px;background:${input.projectColor};margin-right:8px}
.btn{display:inline-block;margin-top:22px;background:#e4e4e7;color:#09090b;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600}
@media(prefers-color-scheme:light){body{background:#f7f7f8}.card{background:#fff;border-color:#e4e4e7}h1,.value{color:#111}.brand,p,.label{color:#71717a}.row{border-top-color:#eee}.btn{background:#18181b;color:#fafafa}}
</style></head><body><div class="card"><div class="brand">Hilm</div><h1>Task reminder</h1>
<p>Hi${input.userName ? ` ${escapeHtml(input.userName)}` : ''}, this is a reminder that you have an upcoming task.</p>
<div class="row"><div class="label">Project</div><div class="value"><span class="dot"></span>${escapeHtml(input.projectName)}</div></div>
<div class="row"><div class="label">Task</div><div class="value">${escapeHtml(input.taskTitle)}</div></div>
<div class="row"><div class="label">Priority</div><div class="value">${escapeHtml(input.priority)}</div></div>
<div class="row"><div class="label">Due</div><div class="value">${escapeHtml(input.dueLabel)}</div></div>
<a class="btn" href="${escapeHtml(input.openUrl)}">Open Task</a></div></body></html>`
  return { subject, html, text }
}

async function sendResendEmail(input: {
  to: string
  subject: string
  html: string
  text: string
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Hilm <onboarding@resend.dev>'
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    const provided =
      request.headers.get('x-cron-secret') ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (cronSecret && provided !== cronSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
    }

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const appUrl = (Deno.env.get('APP_URL') || Deno.env.get('SITE_URL') || '').replace(/\/$/, '')
    if (!appUrl) throw new Error('APP_URL must be set for reminder deep links')

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

    let sent = 0
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

      const { data: authUser } = await admin.auth.admin.getUserById(reminder.user_id)
      const email = authUser.user?.email
      const userName =
        (authUser.user?.user_metadata?.display_name as string | undefined) ||
        email?.split('@')[0] ||
        ''

      const openUrl = `${appUrl}/app/projects/${reminder.project_id}?task=${reminder.task_id}`
      const dueLabel = formatDue(reminder.tasks)
      const channels = reminder.channels?.length ? reminder.channels : ['email']

      const emailAllowed =
        channels.includes('email') &&
        settings?.email_reminders_enabled !== false &&
        projectPref?.email_reminders !== false

      const inAppAllowed =
        channels.includes('in_app') && projectPref?.in_app_notifications !== false

      const pushAllowed =
        channels.includes('push') &&
        settings?.push_notifications_enabled === true &&
        projectPref?.push_notifications !== false

      if (emailAllowed && email) {
        const mail = buildEmail({
          userName,
          projectName: reminder.projects.name,
          projectColor: reminder.projects.color,
          taskTitle: reminder.tasks.title,
          priority: reminder.tasks.priority,
          dueLabel,
          openUrl,
          appUrl,
        })
        await sendResendEmail({ to: email, ...mail })
        sent += 1
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
          href: `/app/tasks/${reminder.task_id}`,
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

      await admin.from('activity_events').insert({
        user_id: reminder.user_id,
        entity_type: 'task',
        entity_id: reminder.task_id,
        project_id: reminder.project_id,
        action: 'reminder_sent',
        summary: `Reminder email sent for "${reminder.tasks.title}"`,
        metadata: {
          reminder_id: reminder.id,
          channels,
        },
      })
    }

    return Response.json(
      { ok: true, processed: dueReminders?.length ?? 0, emailed: sent },
      { headers: corsHeaders },
    )
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Reminder job failed' },
      { status: 500, headers: corsHeaders },
    )
  }
})
