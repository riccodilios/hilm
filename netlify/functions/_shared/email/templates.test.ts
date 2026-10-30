import { describe, expect, it } from 'vitest'
import {
  accountDeletedEmail,
  deliveryTestEmail,
  taskReminderEmail,
  workspaceMentionEmail,
  workspaceTaskAssignedEmail,
  type RenderedEmail,
} from './templates.ts'

const APP = 'https://app.hilm.tech'
const TASK = '11111111-1111-4111-8111-111111111111'
const WS = '22222222-2222-4222-8222-222222222222'
const COMMENT = '33333333-3333-4333-8333-333333333333'
const EVIL = `<script>alert("x")</script>\r\nBcc: victim@example.com`

function expectWellFormed(email: RenderedEmail) {
  expect(email.subject).not.toMatch(/[\r\n]/)
  expect(email.subject.length).toBeLessThanOrEqual(160)
  expect(email.html).toContain('<!DOCTYPE html>')
  expect(email.text.length).toBeGreaterThan(20)
  expect(email.html).not.toContain('<script>')
  // Every absolute link points at the production app.
  for (const [, href] of email.html.matchAll(/href="([^"]+)"/g)) expect(href!.startsWith(`${APP}/`)).toBe(true)
}

describe('taskReminderEmail', () => {
  const base = {
    appBaseUrl: APP,
    recipientName: 'Sara',
    taskId: TASK,
    taskTitle: 'Send the Q3 report',
    projectName: 'Finance',
    priority: 'high',
    dueLabel: 'Fri, Oct 30, 15:00',
  }

  it('renders English with the task link, details and a plain-text part', () => {
    const email = taskReminderEmail({ ...base, locale: 'en' })
    expectWellFormed(email)
    expect(email.category).toBe('notifications')
    expect(email.subject).toBe('Reminder: Send the Q3 report')
    expect(email.html).toContain(`${APP}/personal/tasks/${TASK}`)
    expect(email.html).toContain('lang="en" dir="ltr"')
    expect(email.text).toContain('Priority: High')
    expect(email.text).toContain(`Open task: ${APP}/personal/tasks/${TASK}`)
    expect(email.text).toContain(`Manage email settings: ${APP}/personal/settings`)
  })

  it('renders Arabic right-to-left', () => {
    const email = taskReminderEmail({ ...base, locale: 'ar' })
    expectWellFormed(email)
    expect(email.html).toContain('lang="ar" dir="rtl"')
    expect(email.subject).toBe('تذكير: Send the Q3 report')
    expect(email.text).toContain('الأولوية: عالية')
  })

  it('escapes user content in HTML and strips line breaks from the subject', () => {
    const email = taskReminderEmail({ ...base, locale: 'en', taskTitle: EVIL, projectName: '<b>P</b>' })
    expectWellFormed(email)
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('&lt;b&gt;P&lt;/b&gt;')
    expect(email.subject).toContain('Bcc: victim@example.com')
    expect(email.subject).not.toContain('\n')
  })
})

describe('workspaceTaskAssignedEmail', () => {
  it('renders a single assignment with the actor and due date', () => {
    const email = workspaceTaskAssignedEmail({
      locale: 'en',
      appBaseUrl: APP,
      workspaceId: WS,
      workspaceName: 'Acme',
      actorName: 'Omar',
      tasks: [{ taskId: TASK, ref: 'ACME-12', title: 'Fix login', dueLabel: 'Mon, Nov 2' }],
    })
    expectWellFormed(email)
    expect(email.subject).toBe('Assigned to you: ACME-12 · Fix login')
    expect(email.text).toContain('Omar assigned this task to you in Acme.')
    expect(email.html).toContain(`${APP}/workspace/${WS}/tasks/${TASK}`)
    expect(email.text).toContain(`${APP}/workspace/${WS}/profile`)
  })

  it('renders a digest for several assignments and caps the list', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      taskId: TASK,
      ref: `ACME-${i + 1}`,
      title: `Task ${i + 1}`,
      dueLabel: null,
    }))
    const email = workspaceTaskAssignedEmail({
      locale: 'en',
      appBaseUrl: APP,
      workspaceId: WS,
      workspaceName: 'Acme',
      actorName: null,
      tasks,
    })
    expectWellFormed(email)
    expect(email.template).toBe('workspace-task-assigned-digest')
    expect(email.subject).toBe('12 tasks assigned to you in Acme')
    expect(email.text).toContain('ACME-10 · Task 10')
    expect(email.text).not.toContain('ACME-11 · Task 11')
    expect(email.text).toContain('And 2 more in Hilm.')
  })
})

describe('workspaceMentionEmail', () => {
  it('quotes the comment and links to it', () => {
    const email = workspaceMentionEmail({
      locale: 'en',
      appBaseUrl: APP,
      workspaceId: WS,
      workspaceName: 'Acme',
      mentions: [{ commentId: COMMENT, taskId: TASK, taskRef: 'ACME-3', authorName: 'Lina', snippet: '@Sara can you <review>?' }],
    })
    expectWellFormed(email)
    expect(email.subject).toBe('Lina mentioned you in ACME-3')
    expect(email.html).toContain('@Sara can you &lt;review&gt;?')
    expect(email.html).toContain(`${APP}/workspace/${WS}/tasks/${TASK}?comment=${COMMENT}`)
  })
})

describe('accountDeletedEmail', () => {
  it('uses the security identity and points to the support mailbox', () => {
    const email = accountDeletedEmail({
      locale: 'en',
      appBaseUrl: APP,
      deletedAtLabel: 'Fri, Oct 30, 15:00',
      supportEmail: 'info@hilm.tech',
    })
    expect(email.category).toBe('security')
    expect(email.subject).toBe('Your Hilm account was deleted')
    expect(email.text).toContain('info@hilm.tech')
    expect(email.html).not.toContain('href=')
  })
})

describe('deliveryTestEmail', () => {
  it('renders for every identity', () => {
    for (const category of ['notifications', 'security', 'team'] as const) {
      const email = deliveryTestEmail({ locale: 'en', appBaseUrl: APP, category })
      expectWellFormed(email)
      expect(email.category).toBe(category)
    }
  })
})
