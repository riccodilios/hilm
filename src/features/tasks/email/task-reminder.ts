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
  locale?: 'en' | 'ar'
}

const COPY = {
  en: {
    subject: (task: string) => `Task Reminder — ${task}`,
    hello: (name: string) => `Hi${name ? ` ${name}` : ''},`,
    intro: 'This is a reminder that you have an upcoming task.',
    project: 'Project',
    task: 'Task',
    priority: 'Priority',
    due: 'Due',
    openTask: 'Open Task',
    foot: 'Sent by Hilm',
    brand: 'Hilm',
    title: 'Task reminder',
  },
  ar: {
    subject: (task: string) => `تذكير بمهمة — ${task}`,
    hello: (name: string) => `مرحباً${name ? ` ${name}` : ''}،`,
    intro: 'هذا تذكير بأن لديك مهمة قادمة.',
    project: 'المشروع',
    task: 'المهمة',
    priority: 'الأولوية',
    due: 'الاستحقاق',
    openTask: 'فتح المهمة',
    foot: 'أُرسل من حلم',
    brand: 'حلم',
    title: 'تذكير بمهمة',
  },
} as const

export function buildTaskReminderEmail(payload: ReminderEmailPayload) {
  const locale = payload.locale === 'ar' ? 'ar' : 'en'
  const copy = COPY[locale]
  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  const subject = copy.subject(payload.taskTitle)
  const text = [
    copy.hello(payload.userName),
    '',
    copy.intro,
    '',
    `${copy.project}: ${payload.projectName}`,
    `${copy.task}: ${payload.taskTitle}`,
    `${copy.priority}: ${payload.priority}`,
    `${copy.due}: ${payload.dueLabel}`,
    '',
    `${copy.openTask}: ${payload.openUrl}`,
  ].join('\n')

  const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin:0; padding:0; background:#0a0a0b; color:#f4f4f5; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans Arabic", sans-serif; direction:${dir}; }
    .wrap { max-width:560px; margin:0 auto; padding:32px 20px; }
    .card { background:#111113; border:1px solid #27272a; border-radius:20px; padding:28px; text-align:start; }
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
      <div class="brand">${escapeHtml(copy.brand)}</div>
      <h1>${escapeHtml(copy.title)}</h1>
      <p>${escapeHtml(copy.hello(payload.userName))} ${escapeHtml(copy.intro)}</p>
      <div class="row"><div class="label">${escapeHtml(copy.project)}</div><div class="value"><span class="badge"><span class="dot"></span>${escapeHtml(payload.projectName)}</span></div></div>
      <div class="row"><div class="label">${escapeHtml(copy.task)}</div><div class="value">${escapeHtml(payload.taskTitle)}</div></div>
      <div class="row"><div class="label">${escapeHtml(copy.priority)}</div><div class="value">${escapeHtml(payload.priority)}</div></div>
      <div class="row"><div class="label">${escapeHtml(copy.due)}</div><div class="value">${escapeHtml(payload.dueLabel)}</div></div>
      <a class="btn" href="${escapeHtml(payload.openUrl)}">${escapeHtml(copy.openTask)}</a>
      <p class="foot">${escapeHtml(copy.foot)} · <a href="${escapeHtml(payload.appUrl)}" style="color:inherit">${escapeHtml(payload.appUrl)}</a></p>
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
