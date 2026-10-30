/**
 * Safe manual delivery test. Sends the delivery-test email from each sender identity (and,
 * with --samples, one of each real template with sample data) ONLY to EMAIL_TEST_RECIPIENT.
 * Nothing is sent without --send.
 *
 *   RESEND_API_KEY=re_... EMAIL_TEST_RECIPIENT=you@example.com npm run email:test -- --send
 *   ... npm run email:test -- --send --samples --locale=ar
 *
 * Resend's simulator addresses work too: delivered@resend.dev, bounced@resend.dev,
 * complained@resend.dev (never use made-up addresses at real providers).
 */
import { randomUUID } from 'node:crypto'
import { loadEmailConfig } from '../netlify/functions/_shared/email/config.ts'
import { createEmailService } from '../netlify/functions/_shared/email/service.ts'
import { isValidEmailAddress } from '../netlify/functions/_shared/email/text.ts'
import {
  accountDeletedEmail,
  deliveryTestEmail,
  taskReminderEmail,
  workspaceMentionEmail,
  workspaceTaskAssignedEmail,
} from '../netlify/functions/_shared/email/templates.ts'

const args = new Set(process.argv.slice(2))
const locale = process.argv.find((a) => a.startsWith('--locale='))?.endsWith('ar') ? 'ar' : 'en'
const recipient = process.env.EMAIL_TEST_RECIPIENT?.trim() ?? ''
const config = loadEmailConfig()

if (!isValidEmailAddress(recipient)) {
  console.error('Set EMAIL_TEST_RECIPIENT to the single address that may receive test email.')
  process.exit(1)
}
if (!config.apiKey) {
  console.error('RESEND_API_KEY is not set; nothing to test.')
  process.exit(1)
}
if (config.problems.length) {
  console.error(`Email configuration problems:\n- ${config.problems.join('\n- ')}`)
  process.exit(1)
}

const app = config.appBaseUrl
const id = '00000000-0000-4000-8000-000000000000'
const emails = ['notifications', 'security', 'team'].map((category) =>
  deliveryTestEmail({ locale, appBaseUrl: app, category }),
)
if (args.has('--samples')) {
  emails.push(
    taskReminderEmail({ locale, appBaseUrl: app, recipientName: 'Test', taskId: id, taskTitle: 'Sample task', projectName: 'Sample project', priority: 'medium', dueLabel: 'Today, 15:00' }),
    workspaceTaskAssignedEmail({ locale, appBaseUrl: app, workspaceId: id, workspaceName: 'Sample workspace', actorName: 'Test', tasks: [{ taskId: id, ref: 'TEST-1', title: 'Sample task', dueLabel: null }] }),
    workspaceMentionEmail({ locale, appBaseUrl: app, workspaceId: id, workspaceName: 'Sample workspace', mentions: [{ commentId: id, taskId: id, taskRef: 'TEST-1', authorName: 'Test', snippet: 'This is a sample mention.' }] }),
    accountDeletedEmail({ locale, appBaseUrl: app, deletedAtLabel: 'Today', supportEmail: 'info@hilm.tech' }),
  )
}

console.log(`${emails.length} email(s) prepared for the configured test recipient.`)
for (const e of emails) console.log(`  [${e.category}] ${config.from[e.category]} — ${e.subject}`)
if (!args.has('--send')) {
  console.log('\nDry run. Re-run with --send to deliver.')
  process.exit(0)
}

const service = createEmailService(config)
const run = randomUUID()
let failures = 0
for (const e of emails) {
  const result = await service.send({
    category: e.category,
    template: e.template,
    to: recipient,
    subject: `[Test] ${e.subject}`,
    html: e.html,
    text: e.text,
    idempotencyKey: `hilm/manual-test/${run}/${e.template}/${e.category}`,
  })
  console.log(result.ok ? `  sent ${e.template} (${e.category}): ${result.id}` : `  FAILED ${e.template} (${e.category}): ${result.code}`)
  if (!result.ok) failures += 1
  await new Promise((r) => setTimeout(r, 600))
}
process.exit(failures ? 1 : 0)
