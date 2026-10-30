/**
 * Hilm email templates. Inputs are plain data read on the server; every user-controlled string is
 * reduced to a single clamped line here and escaped by the layout. Links are built from the
 * configured app origin and fixed route shapes only.
 */
import type { EmailCategory } from './config.ts'
import { renderEmail, type EmailContent, type EmailLocale } from './layout.ts'
import { appLink, singleLine } from './text.ts'

export type RenderedEmail = {
  template: string
  category: EmailCategory
  subject: string
  html: string
  text: string
}

const manage = (locale: EmailLocale, appBaseUrl: string, path = '/personal/settings') => ({
  label: locale === 'ar' ? 'إدارة إعدادات البريد' : 'Manage email settings',
  url: appLink(appBaseUrl, path),
})

function build(template: string, category: EmailCategory, subject: string, content: EmailContent): RenderedEmail {
  return { template, category, subject: singleLine(subject, 160), ...renderEmail(content) }
}

const PRIORITY: Record<EmailLocale, Record<string, string>> = {
  en: { none: 'None', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' },
  ar: { none: 'بدون', low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' },
}

// ── Task reminder (Personal OS) ─────────────────────────────────────────────

export type TaskReminderData = {
  locale: EmailLocale
  appBaseUrl: string
  recipientName: string | null
  taskId: string
  taskTitle: string
  projectName: string
  priority: string
  dueLabel: string | null
}

export function taskReminderEmail(d: TaskReminderData): RenderedEmail {
  const title = singleLine(d.taskTitle, 140)
  const project = singleLine(d.projectName, 80)
  const name = singleLine(d.recipientName, 60)
  const ar = d.locale === 'ar'
  const priority = PRIORITY[d.locale][d.priority] ?? singleLine(d.priority, 20)
  const due = d.dueLabel ?? (ar ? 'بدون موعد' : 'No due date')
  const taskUrl = appLink(d.appBaseUrl, `/personal/tasks/${d.taskId}`)

  return build('task-reminder', 'notifications', ar ? `تذكير: ${title}` : `Reminder: ${title}`, {
    locale: d.locale,
    preheader: ar ? `${project} · الاستحقاق ${due}` : `${project} · Due ${due}`,
    eyebrow: ar ? 'تذكير بمهمة' : 'Task reminder',
    heading: title,
    paragraphs: [
      ar
        ? `${name ? `مرحباً ${name}، ` : ''}هذا تذكير بمهمة قادمة في ${project}.`
        : `${name ? `Hi ${name}, this` : 'This'} is a reminder about an upcoming task in ${project}.`,
    ],
    details: [
      { label: ar ? 'المشروع' : 'Project', value: project },
      { label: ar ? 'الأولوية' : 'Priority', value: priority },
      { label: ar ? 'الاستحقاق' : 'Due', value: due },
    ],
    action: { label: ar ? 'فتح المهمة' : 'Open task', url: taskUrl },
    footer: {
      reason: ar
        ? 'تصلك هذه الرسالة لأن تذكيرات البريد مفعّلة في إعدادات حلم.'
        : 'You are receiving this because email reminders are on in your Hilm settings.',
      manage: manage(d.locale, d.appBaseUrl),
    },
  })
}

// ── Workspace task assigned (single or digest) ──────────────────────────────

function workspaceFooter(locale: EmailLocale, appBaseUrl: string, workspaceId: string, workspace: string) {
  return {
    reason:
      locale === 'ar'
        ? `تصلك هذه الرسالة لأنك عضو في ${workspace} وإشعارات مساحة العمل بالبريد مفعّلة.`
        : `You are receiving this because you are a member of ${workspace} and workspace emails are on.`,
    manage: manage(locale, appBaseUrl, `/workspace/${workspaceId}/profile`),
  }
}

export type AssignedTask = {
  taskId: string
  ref: string | null
  title: string
  dueLabel: string | null
}

export type WorkspaceAssignedData = {
  locale: EmailLocale
  appBaseUrl: string
  workspaceId: string
  workspaceName: string
  /** Set only when one person assigned every task in this email. */
  actorName: string | null
  tasks: AssignedTask[]
}

const MAX_LISTED = 10

export function workspaceTaskAssignedEmail(d: WorkspaceAssignedData): RenderedEmail {
  const ar = d.locale === 'ar'
  const workspace = singleLine(d.workspaceName, 80)
  const actor = d.actorName ? singleLine(d.actorName, 60) : null
  const taskUrl = (t: AssignedTask) => appLink(d.appBaseUrl, `/workspace/${d.workspaceId}/tasks/${t.taskId}`)
  const label = (t: AssignedTask) => {
    const title = singleLine(t.title, 120)
    return t.ref ? `${singleLine(t.ref, 24)} · ${title}` : title
  }
  const footer = workspaceFooter(d.locale, d.appBaseUrl, d.workspaceId, workspace)

  if (d.tasks.length === 1) {
    const task = d.tasks[0]!
    const details = [{ label: ar ? 'مساحة العمل' : 'Workspace', value: workspace }]
    if (task.dueLabel) details.push({ label: ar ? 'الاستحقاق' : 'Due', value: task.dueLabel })
    return build(
      'workspace-task-assigned',
      'notifications',
      ar ? `مهمة مسندة إليك: ${label(task)}` : `Assigned to you: ${label(task)}`,
      {
        locale: d.locale,
        preheader: actor
          ? ar ? `أسند ${actor} إليك مهمة في ${workspace}` : `${actor} assigned you a task in ${workspace}`
          : ar ? `مهمة جديدة في ${workspace}` : `New task in ${workspace}`,
        eyebrow: ar ? 'مهمة مسندة إليك' : 'Task assigned',
        heading: label(task),
        paragraphs: [
          actor
            ? ar ? `أسند ${actor} إليك هذه المهمة في ${workspace}.` : `${actor} assigned this task to you in ${workspace}.`
            : ar ? `أُسندت إليك هذه المهمة في ${workspace}.` : `This task was assigned to you in ${workspace}.`,
        ],
        details,
        action: { label: ar ? 'فتح المهمة' : 'Open task', url: taskUrl(task) },
        footer,
      },
    )
  }

  const listed = d.tasks.slice(0, MAX_LISTED)
  const more = d.tasks.length - listed.length
  const count = d.tasks.length
  return build(
    'workspace-task-assigned-digest',
    'notifications',
    ar ? `مهام جديدة مسندة إليك في ${workspace} (${count})` : `${count} tasks assigned to you in ${workspace}`,
    {
      locale: d.locale,
      preheader: listed.map(label).join(' · '),
      eyebrow: ar ? 'مهام مسندة إليك' : 'Tasks assigned',
      heading: ar ? `أُسندت إليك ${count} مهام` : `${count} tasks were assigned to you`,
      paragraphs: [
        actor
          ? ar ? `أسند ${actor} إليك هذه المهام في ${workspace}.` : `${actor} assigned these tasks to you in ${workspace}.`
          : ar ? `أُسندت إليك هذه المهام في ${workspace}.` : `These tasks were assigned to you in ${workspace}.`,
        ...(more > 0
          ? [ar ? `و${more} مهام أخرى في Hilm.` : `And ${more} more in Hilm.`]
          : []),
      ],
      items: listed.map((t) => ({
        title: label(t),
        meta: t.dueLabel ? (ar ? `الاستحقاق ${t.dueLabel}` : `Due ${t.dueLabel}`) : undefined,
        url: taskUrl(t),
      })),
      action: {
        label: ar ? 'فتح المهام' : 'Open tasks',
        url: appLink(d.appBaseUrl, `/workspace/${d.workspaceId}/tasks`),
      },
      footer,
    },
  )
}

// ── Workspace mention (single or digest) ────────────────────────────────────

export type Mention = {
  commentId: string
  taskId: string
  taskRef: string
  authorName: string
  snippet: string
}

export type WorkspaceMentionData = {
  locale: EmailLocale
  appBaseUrl: string
  workspaceId: string
  workspaceName: string
  mentions: Mention[]
}

export function workspaceMentionEmail(d: WorkspaceMentionData): RenderedEmail {
  const ar = d.locale === 'ar'
  const workspace = singleLine(d.workspaceName, 80)
  const url = (m: Mention) =>
    appLink(d.appBaseUrl, `/workspace/${d.workspaceId}/tasks/${m.taskId}?comment=${m.commentId}`)
  const footer = workspaceFooter(d.locale, d.appBaseUrl, d.workspaceId, workspace)

  if (d.mentions.length === 1) {
    const m = d.mentions[0]!
    const author = singleLine(m.authorName, 60)
    const ref = singleLine(m.taskRef, 120)
    return build(
      'workspace-mention',
      'notifications',
      ar ? `${author} أشار إليك في ${ref}` : `${author} mentioned you in ${ref}`,
      {
        locale: d.locale,
        preheader: singleLine(m.snippet, 120),
        eyebrow: ar ? 'إشارة جديدة' : 'New mention',
        heading: ar ? `${author} أشار إليك في ${ref}` : `${author} mentioned you in ${ref}`,
        paragraphs: [ar ? `في مساحة العمل ${workspace}:` : `In ${workspace}:`],
        quote: singleLine(m.snippet, 280),
        action: { label: ar ? 'عرض التعليق' : 'View comment', url: url(m) },
        footer,
      },
    )
  }

  const listed = d.mentions.slice(0, MAX_LISTED)
  const count = d.mentions.length
  return build(
    'workspace-mention-digest',
    'notifications',
    ar ? `إشارات جديدة إليك في ${workspace} (${count})` : `${count} new mentions in ${workspace}`,
    {
      locale: d.locale,
      preheader: listed.map((m) => `${singleLine(m.authorName, 40)}: ${singleLine(m.snippet, 60)}`).join(' · '),
      eyebrow: ar ? 'إشارات جديدة' : 'New mentions',
      heading: ar ? `لديك ${count} إشارات جديدة` : `You were mentioned ${count} times`,
      paragraphs: [ar ? `في مساحة العمل ${workspace}:` : `In ${workspace}:`],
      items: listed.map((m) => ({
        title: ar
          ? `${singleLine(m.authorName, 60)} في ${singleLine(m.taskRef, 60)}`
          : `${singleLine(m.authorName, 60)} in ${singleLine(m.taskRef, 60)}`,
        meta: singleLine(m.snippet, 140),
        url: url(m),
      })),
      footer,
    },
  )
}

// ── Account deleted (security notice) ───────────────────────────────────────

export type AccountDeletedData = {
  locale: EmailLocale
  appBaseUrl: string
  deletedAtLabel: string
  supportEmail: string
}

export function accountDeletedEmail(d: AccountDeletedData): RenderedEmail {
  const ar = d.locale === 'ar'
  const support = singleLine(d.supportEmail, 120)
  return build(
    'account-deleted',
    'security',
    ar ? 'تم حذف حسابك في حلم' : 'Your Hilm account was deleted',
    {
      locale: d.locale,
      preheader: ar ? 'حُذف حسابك وبياناته الشخصية نهائياً.' : 'Your account and its personal data were permanently deleted.',
      eyebrow: ar ? 'إشعار أمان' : 'Security notice',
      heading: ar ? 'تم حذف حسابك' : 'Your account was deleted',
      paragraphs: [
        ar
          ? `حُذف حسابك في حلم وبياناته الشخصية نهائياً في ${d.deletedAtLabel}.`
          : `Your Hilm account and its personal data were permanently deleted on ${d.deletedAtLabel}.`,
        ar
          ? 'إن كنت أنت من قام بذلك فلا حاجة لأي إجراء آخر.'
          : 'If you did this, there is nothing else you need to do.',
      ],
      note: ar
        ? `إن لم تقم بذلك فقد يكون حسابك تعرّض للاختراق. راسلنا على ${support} وغيّر كلمة مرور بريدك الإلكتروني.`
        : `If this wasn't you, your sign-in may have been compromised. Contact ${support} and change your email password.`,
      footer: {
        reason: ar
          ? 'هذا إشعار أمان يُرسل دائماً عند حذف حساب في حلم.'
          : 'This security notice is always sent when a Hilm account is deleted.',
      },
    },
  )
}

// ── Configuration test (manual procedure only) ──────────────────────────────

export function deliveryTestEmail(d: { locale: EmailLocale; appBaseUrl: string; category: EmailCategory }): RenderedEmail {
  const ar = d.locale === 'ar'
  return build('delivery-test', d.category, ar ? 'اختبار بريد حلم' : 'Hilm email delivery test', {
    locale: d.locale,
    preheader: ar ? 'إعداد البريد يعمل.' : 'Email delivery is configured.',
    eyebrow: ar ? 'اختبار' : 'Test',
    heading: ar ? 'إعداد البريد يعمل' : 'Email delivery works',
    paragraphs: [
      ar
        ? `أُرسلت هذه الرسالة من هوية "${d.category}" عبر Resend للتحقق من الإعداد.`
        : `This message was sent from the "${d.category}" identity through Resend to verify the setup.`,
    ],
    action: { label: ar ? 'فتح حلم' : 'Open Hilm', url: appLink(d.appBaseUrl, '/login') },
    footer: {
      reason: ar
        ? 'أُرسلت إلى عنوان الاختبار المحدد في EMAIL_TEST_RECIPIENT فقط.'
        : 'Sent only to the address configured in EMAIL_TEST_RECIPIENT.',
    },
  })
}
