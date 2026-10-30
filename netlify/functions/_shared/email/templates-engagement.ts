/**
 * Templates for auth codes (Supabase hook), workspace invitations, task updates, workspace task
 * reminders and product broadcasts. Same rules as templates.ts: single-line clamped user text,
 * escaping in the layout, links only from fixed shapes or an allow-list.
 */
import { renderEmail, type EmailLocale } from './layout.ts'
import type { RenderedEmail } from './templates.ts'
import { appLink, singleLine } from './text.ts'

const manage = (locale: EmailLocale, url: string) => ({
  label: locale === 'ar' ? 'إدارة إعدادات البريد' : 'Manage email settings',
  url,
})

function build(template: string, category: RenderedEmail['category'], subject: string, content: Parameters<typeof renderEmail>[0]): RenderedEmail {
  return { template, category, subject: singleLine(subject, 160), ...renderEmail(content) }
}

// ── Auth (Supabase Send Email hook) ─────────────────────────────────────────

export type AuthEmailAction =
  | 'signup'
  | 'recovery'
  | 'magiclink'
  | 'email'
  | 'invite'
  | 'email_change'
  | 'reauthentication'

const AUTH_COPY: Record<
  AuthEmailAction,
  Record<EmailLocale, { subject: (code: string) => string; heading: string; intro: string; button: string; codeLabel: string }>
> = {
  signup: {
    en: { subject: (c) => (c ? `${c} is your Hilm verification code` : 'Confirm your Hilm account'), heading: 'Confirm your email', intro: 'Enter this code in Hilm to finish creating your account, or use the button.', button: 'Confirm email', codeLabel: 'Verification code' },
    ar: { subject: (c) => (c ? `${c} رمز التحقق في حلم` : 'أكّد حسابك في حلم'), heading: 'أكّد بريدك الإلكتروني', intro: 'أدخل هذا الرمز في حلم لإكمال إنشاء حسابك، أو استخدم الزر.', button: 'تأكيد البريد', codeLabel: 'رمز التحقق' },
  },
  recovery: {
    en: { subject: (c) => (c ? `${c} is your Hilm password reset code` : 'Reset your Hilm password'), heading: 'Reset your password', intro: 'Enter this code in Hilm to choose a new password, or use the button.', button: 'Reset password', codeLabel: 'Reset code' },
    ar: { subject: (c) => (c ? `${c} رمز إعادة تعيين كلمة المرور في حلم` : 'إعادة تعيين كلمة المرور في حلم'), heading: 'إعادة تعيين كلمة المرور', intro: 'أدخل هذا الرمز في حلم لاختيار كلمة مرور جديدة، أو استخدم الزر.', button: 'إعادة تعيين كلمة المرور', codeLabel: 'رمز إعادة التعيين' },
  },
  magiclink: {
    en: { subject: (c) => (c ? `${c} is your Hilm sign-in code` : 'Your Hilm sign-in link'), heading: 'Sign in to Hilm', intro: 'Use this code or the button to sign in.', button: 'Sign in', codeLabel: 'Sign-in code' },
    ar: { subject: (c) => (c ? `${c} رمز الدخول إلى حلم` : 'رابط الدخول إلى حلم'), heading: 'الدخول إلى حلم', intro: 'استخدم هذا الرمز أو الزر لتسجيل الدخول.', button: 'تسجيل الدخول', codeLabel: 'رمز الدخول' },
  },
  email: {
    en: { subject: (c) => `${c} is your Hilm sign-in code`, heading: 'Sign in to Hilm', intro: 'Use this code or the button to sign in.', button: 'Sign in', codeLabel: 'Sign-in code' },
    ar: { subject: (c) => `${c} رمز الدخول إلى حلم`, heading: 'الدخول إلى حلم', intro: 'استخدم هذا الرمز أو الزر لتسجيل الدخول.', button: 'تسجيل الدخول', codeLabel: 'رمز الدخول' },
  },
  invite: {
    en: { subject: () => 'You have been invited to Hilm', heading: 'You are invited to Hilm', intro: 'Accept the invitation to create your account.', button: 'Accept invitation', codeLabel: 'Invitation code' },
    ar: { subject: () => 'دعوة للانضمام إلى حلم', heading: 'أنت مدعو إلى حلم', intro: 'اقبل الدعوة لإنشاء حسابك.', button: 'قبول الدعوة', codeLabel: 'رمز الدعوة' },
  },
  email_change: {
    en: { subject: () => 'Confirm your new email for Hilm', heading: 'Confirm your email change', intro: 'Confirm that you want to use this address for your Hilm account.', button: 'Confirm email change', codeLabel: 'Confirmation code' },
    ar: { subject: () => 'أكّد بريدك الجديد في حلم', heading: 'تأكيد تغيير البريد', intro: 'أكّد أنك تريد استخدام هذا العنوان لحسابك في حلم.', button: 'تأكيد تغيير البريد', codeLabel: 'رمز التأكيد' },
  },
  reauthentication: {
    en: { subject: (c) => `${c} is your Hilm confirmation code`, heading: 'Confirm it is you', intro: 'Enter this code in Hilm to continue.', button: 'Open Hilm', codeLabel: 'Confirmation code' },
    ar: { subject: (c) => `${c} رمز التأكيد في حلم`, heading: 'أكّد هويتك', intro: 'أدخل هذا الرمز في حلم للمتابعة.', button: 'فتح حلم', codeLabel: 'رمز التأكيد' },
  },
}

const CODE_RE = /^[0-9A-Za-z]{4,10}$/

export function authEmail(d: {
  locale: EmailLocale
  action: AuthEmailAction
  code: string | null
  /** Supabase verify URL built by the hook (keeps Supabase's token + redirect handling). */
  confirmUrl: string | null
}): RenderedEmail {
  const copy = AUTH_COPY[d.action][d.locale]
  const code = d.code && CODE_RE.test(d.code) ? d.code : null
  const ar = d.locale === 'ar'
  return build(`auth-${d.action}`, 'security', copy.subject(code ?? ''), {
    locale: d.locale,
    preheader: code ? `${copy.codeLabel}: ${code}` : copy.intro,
    heading: copy.heading,
    paragraphs: [copy.intro],
    code: code ? { label: copy.codeLabel, value: code } : undefined,
    action: d.confirmUrl ? { label: copy.button, url: d.confirmUrl } : undefined,
    note: ar
      ? 'الرمز والرابط صالحان لفترة قصيرة ولمرة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة؛ لن يتغير شيء في حسابك.'
      : "The code and link expire soon and work once. If you didn't request this, ignore this email; nothing changes in your account.",
    footer: {
      reason: ar ? 'أُرسلت هذه الرسالة لأن أحدهم استخدم بريدك في حلم.' : 'Sent because this address was used on Hilm.',
    },
  })
}

// ── Workspace invitation ────────────────────────────────────────────────────

export function workspaceInviteEmail(d: {
  locale: EmailLocale
  appBaseUrl: string
  inviterName: string
  workspaceName: string
  inviteCode: string
}): RenderedEmail {
  const ar = d.locale === 'ar'
  const inviter = singleLine(d.inviterName, 60)
  const workspace = singleLine(d.workspaceName, 80)
  const joinUrl = appLink(d.appBaseUrl, `/workspace?join=${encodeURIComponent(d.inviteCode)}`)
  return build(
    'workspace-invite',
    'team',
    ar ? `${inviter} يدعوك للانضمام إلى ${workspace} في حلم` : `${inviter} invited you to ${workspace} on Hilm`,
    {
      locale: d.locale,
      preheader: ar ? `انضم إلى ${workspace} في حلم` : `Join ${workspace} on Hilm`,
      eyebrow: ar ? 'دعوة إلى مساحة عمل' : 'Workspace invitation',
      heading: ar ? `انضم إلى ${workspace}` : `Join ${workspace}`,
      paragraphs: [
        ar
          ? `دعاك ${inviter} للانضمام إلى مساحة العمل ${workspace} في حلم، حيث يدير الفريق المشاريع والمهام والاجتماعات معاً.`
          : `${inviter} invited you to the ${workspace} workspace on Hilm, where the team runs projects, tasks and meetings together.`,
        ar
          ? 'إن لم يكن لديك حساب فستنشئه أولاً، ثم تنضم مباشرة.'
          : "If you don't have an account yet, you'll create one first and then join.",
      ],
      details: [{ label: ar ? 'رمز الدعوة' : 'Invite code', value: singleLine(d.inviteCode, 24) }],
      action: { label: ar ? 'الانضمام إلى مساحة العمل' : 'Join workspace', url: joinUrl },
      note: ar
        ? 'إن لم تكن تتوقع هذه الدعوة فيمكنك تجاهلها.'
        : "If you weren't expecting this invitation, you can ignore it.",
      footer: {
        reason: ar
          ? `أُرسلت بطلب من ${inviter} عبر حلم.`
          : `Sent by Hilm on behalf of ${inviter}.`,
      },
    },
  )
}

// ── Workspace task updates (digest) ─────────────────────────────────────────

const STATUS: Record<EmailLocale, Record<string, string>> = {
  en: { backlog: 'Backlog', todo: 'To do', in_progress: 'In progress', in_review: 'In review', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled', archived: 'Archived' },
  ar: { backlog: 'المتراكم', todo: 'للتنفيذ', in_progress: 'قيد التنفيذ', in_review: 'قيد المراجعة', blocked: 'معلّقة', done: 'مكتملة', cancelled: 'ملغاة', archived: 'مؤرشفة' },
}
const PRIORITY: Record<EmailLocale, Record<string, string>> = {
  en: { none: 'None', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' },
  ar: { none: 'بدون', low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' },
}

export type TaskUpdate = {
  taskId: string
  ref: string | null
  title: string
  actorName: string | null
  changes: {
    status?: { from: string; to: string }
    priority?: { from: string; to: string }
    due?: boolean
    title?: boolean
    comment?: boolean
  }
  dueLabel: string | null
  commentSnippet?: string | null
}

function describeChange(u: TaskUpdate, locale: EmailLocale): string {
  const ar = locale === 'ar'
  const parts: string[] = []
  const label = (map: Record<string, string>, v: string) => map[v] ?? singleLine(v, 24)
  if (u.changes.status) {
    parts.push(
      ar
        ? `الحالة: ${label(STATUS.ar, u.changes.status.from)} ← ${label(STATUS.ar, u.changes.status.to)}`
        : `Status: ${label(STATUS.en, u.changes.status.from)} → ${label(STATUS.en, u.changes.status.to)}`,
    )
  }
  if (u.changes.priority) {
    parts.push(
      ar
        ? `الأولوية: ${label(PRIORITY.ar, u.changes.priority.to)}`
        : `Priority: ${label(PRIORITY.en, u.changes.priority.to)}`,
    )
  }
  if (u.changes.due) parts.push(ar ? `الاستحقاق: ${u.dueLabel ?? 'أُزيل'}` : `Due: ${u.dueLabel ?? 'removed'}`)
  if (u.changes.title) parts.push(ar ? 'تغيّر العنوان' : 'Title changed')
  if (u.changes.comment) {
    const snippet = u.commentSnippet ? `: “${singleLine(u.commentSnippet, 120)}”` : ''
    parts.push(ar ? `تعليق جديد${snippet}` : `New comment${snippet}`)
  }
  const actor = u.actorName ? singleLine(u.actorName, 60) : null
  const by = actor ? (ar ? ` · بواسطة ${actor}` : ` · by ${actor}`) : ''
  return parts.join(' · ') + by
}

export function workspaceTaskUpdatesEmail(d: {
  locale: EmailLocale
  appBaseUrl: string
  workspaceId: string
  workspaceName: string
  updates: TaskUpdate[]
}): RenderedEmail {
  const ar = d.locale === 'ar'
  const workspace = singleLine(d.workspaceName, 80)
  const label = (u: TaskUpdate) => {
    const title = singleLine(u.title, 120)
    return u.ref ? `${singleLine(u.ref, 24)} · ${title}` : title
  }
  const url = (u: TaskUpdate) => appLink(d.appBaseUrl, `/workspace/${d.workspaceId}/tasks/${u.taskId}`)
  const footer = {
    reason: ar
      ? `تصلك هذه الرسالة لأن تحديثات المهام مفعّلة لك في ${workspace}.`
      : `You are receiving this because task updates are on for you in ${workspace}.`,
    manage: manage(d.locale, appLink(d.appBaseUrl, `/workspace/${d.workspaceId}/profile`)),
  }
  const items = d.updates.slice(0, 10).map((u) => ({ title: label(u), meta: describeChange(u, d.locale), url: url(u) }))
  const single = d.updates.length === 1 ? d.updates[0]! : null

  return build(
    single ? 'workspace-task-updated' : 'workspace-task-updated-digest',
    'notifications',
    single
      ? ar ? `تحديث على ${label(single)}` : `Update on ${label(single)}`
      : ar ? `تحديثات على مهامك في ${workspace} (${d.updates.length})` : `${d.updates.length} updates on your tasks in ${workspace}`,
    {
      locale: d.locale,
      preheader: items.map((i) => i.meta).join(' · '),
      eyebrow: ar ? 'تحديثات المهام' : 'Task updates',
      heading: single ? label(single) : ar ? 'تحديثات على مهامك' : 'Updates on your tasks',
      paragraphs: [ar ? `في مساحة العمل ${workspace}:` : `In ${workspace}:`],
      items,
      action: single
        ? { label: ar ? 'فتح المهمة' : 'Open task', url: url(single) }
        : { label: ar ? 'فتح المهام' : 'Open tasks', url: appLink(d.appBaseUrl, `/workspace/${d.workspaceId}/tasks`) },
      footer,
    },
  )
}

// ── Workspace task reminder ─────────────────────────────────────────────────

export function workspaceTaskReminderEmail(d: {
  locale: EmailLocale
  appBaseUrl: string
  workspaceId: string
  workspaceName: string
  taskId: string
  ref: string | null
  title: string
  priority: string
  dueLabel: string | null
}): RenderedEmail {
  const ar = d.locale === 'ar'
  const workspace = singleLine(d.workspaceName, 80)
  const title = singleLine(d.title, 140)
  const heading = d.ref ? `${singleLine(d.ref, 24)} · ${title}` : title
  const due = d.dueLabel ?? (ar ? 'بدون موعد' : 'No due date')
  return build('workspace-task-reminder', 'notifications', ar ? `تذكير: ${heading}` : `Reminder: ${heading}`, {
    locale: d.locale,
    preheader: ar ? `${workspace} · الاستحقاق ${due}` : `${workspace} · Due ${due}`,
    eyebrow: ar ? 'تذكير بمهمة' : 'Task reminder',
    heading,
    paragraphs: [ar ? `تذكير بمهمة قادمة في ${workspace}.` : `A reminder about an upcoming task in ${workspace}.`],
    details: [
      { label: ar ? 'مساحة العمل' : 'Workspace', value: workspace },
      { label: ar ? 'الأولوية' : 'Priority', value: PRIORITY[d.locale][d.priority] ?? singleLine(d.priority, 20) },
      { label: ar ? 'الاستحقاق' : 'Due', value: due },
    ],
    action: { label: ar ? 'فتح المهمة' : 'Open task', url: appLink(d.appBaseUrl, `/workspace/${d.workspaceId}/tasks/${d.taskId}`) },
    footer: {
      reason: ar
        ? 'تصلك هذه الرسالة لأن تذكيرات البريد مفعّلة في إعدادات حلم.'
        : 'You are receiving this because email reminders are on in your Hilm settings.',
      manage: manage(d.locale, appLink(d.appBaseUrl, '/personal/settings')),
    },
  })
}

// ── Product broadcast ───────────────────────────────────────────────────────

export type BroadcastContent = {
  subject: string
  preheader?: string
  heading: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
}

const CTA_HOSTS = new Set(['hilm.tech', 'www.hilm.tech', 'app.hilm.tech'])

/** Broadcast buttons may only point at Hilm's own sites. */
export function allowedCtaUrl(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || !CTA_HOSTS.has(url.hostname) || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export function broadcastParagraphs(body: string) {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => singleLine(p, 1200))
    .filter(Boolean)
    .slice(0, 12)
}

export function broadcastEmail(d: {
  locale: EmailLocale
  appBaseUrl: string
  content: BroadcastContent
  unsubscribeUrl: string
}): RenderedEmail {
  const ar = d.locale === 'ar'
  const cta = allowedCtaUrl(d.content.ctaUrl)
  return build('broadcast', 'marketing', d.content.subject, {
    locale: d.locale,
    preheader: singleLine(d.content.preheader || d.content.heading, 140),
    heading: singleLine(d.content.heading, 160),
    paragraphs: broadcastParagraphs(d.content.body),
    action: cta && d.content.ctaLabel ? { label: singleLine(d.content.ctaLabel, 40), url: cta } : undefined,
    footer: {
      reason: ar
        ? 'تصلك أخبار حلم لأن لديك حساباً في حلم.'
        : 'You are receiving Hilm product news because you have a Hilm account.',
      manage: manage(d.locale, appLink(d.appBaseUrl, '/personal/settings')),
      unsubscribe: { label: ar ? 'إلغاء الاشتراك' : 'Unsubscribe', url: d.unsubscribeUrl },
    },
  })
}
