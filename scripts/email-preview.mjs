/**
 * Render every Hilm email template (English + Arabic) with sample data into email-previews/ for
 * visual review. Sends nothing.
 *
 *   npm run email:preview
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_APP_BASE_URL } from '../netlify/functions/_shared/email/config.ts'
import {
  accountDeletedEmail,
  deliveryTestEmail,
  taskReminderEmail,
  workspaceMentionEmail,
  workspaceTaskAssignedEmail,
} from '../netlify/functions/_shared/email/templates.ts'

const app = DEFAULT_APP_BASE_URL
const ids = {
  task: '11111111-1111-4111-8111-111111111111',
  ws: '22222222-2222-4222-8222-222222222222',
  comment: '33333333-3333-4333-8333-333333333333',
}
const samples = {
  en: {
    name: 'Sara',
    task: 'Send the Q3 board report',
    project: 'Finance',
    due: 'Fri, Oct 30, 15:00',
    workspace: 'Acme Studio',
    actor: 'Omar',
    snippet: '@Sara can you review the numbers before Friday?',
  },
  ar: {
    name: 'سارة',
    task: 'إرسال تقرير الربع الثالث',
    project: 'المالية',
    due: 'الجمعة، 30 أكتوبر، 15:00',
    workspace: 'استوديو أكمي',
    actor: 'عمر',
    snippet: '@سارة هل يمكنك مراجعة الأرقام قبل الجمعة؟',
  },
}

const outDir = path.resolve('email-previews')
fs.mkdirSync(outDir, { recursive: true })
const written = []

for (const locale of ['en', 'ar']) {
  const s = samples[locale]
  const emails = {
    'task-reminder': taskReminderEmail({
      locale, appBaseUrl: app, recipientName: s.name, taskId: ids.task, taskTitle: s.task,
      projectName: s.project, priority: 'high', dueLabel: s.due,
    }),
    'workspace-task-assigned': workspaceTaskAssignedEmail({
      locale, appBaseUrl: app, workspaceId: ids.ws, workspaceName: s.workspace, actorName: s.actor,
      tasks: [{ taskId: ids.task, ref: 'ACME-12', title: s.task, dueLabel: s.due }],
    }),
    'workspace-task-assigned-digest': workspaceTaskAssignedEmail({
      locale, appBaseUrl: app, workspaceId: ids.ws, workspaceName: s.workspace, actorName: s.actor,
      tasks: [12, 13, 14].map((n) => ({ taskId: ids.task, ref: `ACME-${n}`, title: `${s.task} (${n})`, dueLabel: n === 12 ? s.due : null })),
    }),
    'workspace-mention': workspaceMentionEmail({
      locale, appBaseUrl: app, workspaceId: ids.ws, workspaceName: s.workspace,
      mentions: [{ commentId: ids.comment, taskId: ids.task, taskRef: 'ACME-12', authorName: s.actor, snippet: s.snippet }],
    }),
    'account-deleted': accountDeletedEmail({ locale, appBaseUrl: app, deletedAtLabel: s.due, supportEmail: 'info@hilm.tech' }),
    'delivery-test': deliveryTestEmail({ locale, appBaseUrl: app, category: 'team' }),
  }
  for (const [name, email] of Object.entries(emails)) {
    const base = path.join(outDir, `${name}.${locale}`)
    fs.writeFileSync(`${base}.html`, email.html)
    fs.writeFileSync(`${base}.txt`, `Subject: ${email.subject}\nFrom identity: ${email.category}\n\n${email.text}\n`)
    written.push(`${name}.${locale}`)
  }
}

const index = `<!DOCTYPE html><meta charset="utf-8"><title>Hilm email previews</title>
<body style="background:#111;color:#eee;font-family:system-ui;padding:24px">
<h1 style="font-size:18px">Hilm email previews</h1><ul>${written
  .map((n) => `<li><a style="color:#ddd" href="${n}.html">${n}</a> · <a style="color:#999" href="${n}.txt">text</a></li>`)
  .join('')}</ul></body>`
fs.writeFileSync(path.join(outDir, 'index.html'), index)
console.log(`Wrote ${written.length} previews to ${outDir}`)
