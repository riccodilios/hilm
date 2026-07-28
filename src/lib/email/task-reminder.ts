export type ReminderEmailPayload = {
  to: string
  userName: string
  projectName: string
  projectColor: string
  taskTitle: string
  priority: string
  dueLabel: string
  openUrl: string
  appUrl: string
}

export function buildTaskReminderEmail(payload: ReminderEmailPayload) {
  const subject = `Task Reminder — ${payload.taskTitle}`
  const text = [
    `Hi${payload.userName ? ` ${payload.userName}` : ''},`,
    '',
    'This is a reminder that you have an upcoming task.',
    '',
    `Project: ${payload.projectName}`,
    `Task: ${payload.taskTitle}`,
    `Priority: ${payload.priority}`,
    `Due: ${payload.dueLabel}`,
    '',
    `Open task: ${payload.openUrl}`,
  ].join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin:0; padding:0; background:#0a0a0b; color:#f4f4f5; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    .wrap { max-width:560px; margin:0 auto; padding:32px 20px; }
    .card { background:#111113; border:1px solid #27272a; border-radius:20px; padding:28px; }
    .brand { font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:#a1a1aa; margin-bottom:18px; }
    h1 { font-size:22px; line-height:1.3; margin:0 0 12px; font-weight:560; color:#fafafa; }
    p { margin:0 0 18px; color:#a1a1aa; font-size:15px; line-height:1.6; }
    .row { display:flex; gap:12px; padding:12px 0; border-top:1px solid #1c1c1f; }
    .label { width:88px; flex-shrink:0; color:#71717a; font-size:13px; }
    .value { color:#f4f4f5; font-size:14px; font-weight:500; }
    .badge { display:inline-flex; align-items:center; gap:8px; }
    .dot { width:8px; height:8px; border-radius:999px; background:${payload.projectColor || '#60a5fa'}; }
    .btn { display:inline-block; margin-top:22px; background:#e4e4e7; color:#09090b; text-decoration:none; padding:12px 18px; border-radius:12px; font-size:14px; font-weight:600; }
    .foot { margin-top:18px; font-size:12px; color:#71717a; }
    @media (prefers-color-scheme: light) {
      body { background:#f7f7f8; color:#111113; }
      .card { background:#ffffff; border-color:#e4e4e7; }
      .brand, p, .label, .foot { color:#71717a; }
      h1, .value { color:#111113; }
      .row { border-top-color:#eee; }
      .btn { background:#18181b; color:#fafafa; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="brand">Hilm</div>
      <h1>Task reminder</h1>
      <p>Hi${payload.userName ? ` ${escapeHtml(payload.userName)}` : ''}, this is a reminder that you have an upcoming task.</p>
      <div class="row"><div class="label">Project</div><div class="value"><span class="badge"><span class="dot"></span>${escapeHtml(payload.projectName)}</span></div></div>
      <div class="row"><div class="label">Task</div><div class="value">${escapeHtml(payload.taskTitle)}</div></div>
      <div class="row"><div class="label">Priority</div><div class="value">${escapeHtml(payload.priority)}</div></div>
      <div class="row"><div class="label">Due</div><div class="value">${escapeHtml(payload.dueLabel)}</div></div>
      <a class="btn" href="${escapeHtml(payload.openUrl)}">Open Task</a>
      <p class="foot">Sent by Hilm · <a href="${escapeHtml(payload.appUrl)}" style="color:inherit">${escapeHtml(payload.appUrl)}</a></p>
    </div>
  </div>
</body>
</html>`

  return { subject, html, text }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
