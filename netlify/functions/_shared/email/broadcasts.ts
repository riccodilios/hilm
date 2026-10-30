/**
 * Admin product broadcasts (marketing, opt-out). Only addresses listed in HILM_ADMIN_EMAILS may
 * compose. "send" queues one outbox row per opted-in, confirmed, non-suppressed user; the
 * dispatcher delivers them with a signed one-click unsubscribe link and List-Unsubscribe headers.
 */
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import type { EmailConfig } from './config.ts'
import type { EmailLocale } from './layout.ts'
import type { EmailService } from './service.ts'
import { allowedCtaUrl, broadcastEmail, type BroadcastContent } from './templates-engagement.ts'
import { unsubscribeUrl } from './unsubscribe.ts'

type Queryable = Pick<pg.Client, 'query'>

const contentSchema = z.object({
  subject: z.string().trim().min(1).max(150),
  preheader: z.string().trim().max(150).optional(),
  heading: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
  ctaLabel: z.string().trim().max(40).optional(),
  ctaUrl: z.string().trim().max(500).optional(),
})

export const broadcastRequestSchema = z.object({
  action: z.enum(['preview', 'test', 'send']),
  audience: z.enum(['all', 'en', 'ar']).default('all'),
  content: z
    .object({ en: contentSchema.optional(), ar: contentSchema.optional() })
    .refine((c) => c.en || c.ar, 'Provide English or Arabic content'),
  confirm: z.string().optional(),
})

export type BroadcastRequest = z.infer<typeof broadcastRequestSchema>

export class BroadcastError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function isBroadcastAdmin(config: EmailConfig, user: { email: string | null; emailConfirmed: boolean }) {
  return Boolean(user.email && user.emailConfirmed && config.adminEmails.includes(user.email.toLowerCase()))
}

function validateContent(content: BroadcastRequest['content'], audience: BroadcastRequest['audience']) {
  for (const locale of ['en', 'ar'] as const) {
    const c = content[locale]
    if (!c) continue
    if (c.ctaUrl && !allowedCtaUrl(c.ctaUrl)) throw new BroadcastError(400, 'cta_url_not_allowed')
    if (Boolean(c.ctaUrl) !== Boolean(c.ctaLabel)) throw new BroadcastError(400, 'cta_incomplete')
  }
  if (audience !== 'all' && !content[audience]) throw new BroadcastError(400, 'missing_audience_content')
}

const AUDIENCE_SQL = `
  from auth.users u
  join public.user_settings s on s.user_id = u.id
  where u.email_confirmed_at is not null and u.deleted_at is null
    and s.email_marketing_enabled
    and not exists (select 1 from private.email_suppressions x where x.email = lower(u.email))
    and ($1 = 'all' or coalesce(s.locale, 'en') = $1)`

export async function audienceCounts(db: Queryable) {
  const counts: Record<'all' | 'en' | 'ar', number> = { all: 0, en: 0, ar: 0 }
  for (const audience of ['all', 'en', 'ar'] as const) {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n ${AUDIENCE_SQL}`, [audience])
    counts[audience] = rows[0]?.n ?? 0
  }
  return counts
}

export async function recentBroadcasts(db: Queryable) {
  const { rows } = await db.query<{ id: string; created_at: Date; audience: string; recipients: number; subject: string | null }>(
    `select id, created_at, audience, recipients,
            coalesce(content #>> '{en,subject}', content #>> '{ar,subject}') as subject
     from private.email_broadcasts order by created_at desc limit 5`,
  )
  return rows
}

export async function handleBroadcast(
  request: BroadcastRequest,
  admin: { id: string; email: string },
  deps: { db: Queryable; service: EmailService; config: EmailConfig },
) {
  validateContent(request.content, request.audience)
  const { config } = deps
  const locales = (['en', 'ar'] as const).filter((l) => request.content[l])

  if (request.action === 'preview') {
    const html: Partial<Record<EmailLocale, string>> = {}
    for (const locale of locales) {
      html[locale] = broadcastEmail({
        locale,
        appBaseUrl: config.appBaseUrl,
        content: request.content[locale] as BroadcastContent,
        unsubscribeUrl: `${config.appBaseUrl}/api/email-unsubscribe?preview=1`,
      }).html
    }
    return { html }
  }

  if (!deps.service.enabled) throw new BroadcastError(503, 'not_configured')
  if (!config.unsubscribeSecret) throw new BroadcastError(503, 'unsubscribe_not_configured')

  if (request.action === 'test') {
    const run = randomUUID()
    const sent: string[] = []
    for (const locale of locales) {
      const unsubscribe = unsubscribeUrl(config.appBaseUrl, config.unsubscribeSecret, admin.id)
      const email = broadcastEmail({
        locale,
        appBaseUrl: config.appBaseUrl,
        content: request.content[locale] as BroadcastContent,
        unsubscribeUrl: unsubscribe,
      })
      const result = await deps.service.send({
        category: email.category,
        template: email.template,
        to: admin.email,
        subject: `[Test] ${email.subject}`,
        html: email.html,
        text: email.text,
        idempotencyKey: `hilm/broadcast-test/${run}/${locale}`,
        headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      })
      if (!result.ok) throw new BroadcastError(502, result.code)
      sent.push(locale)
    }
    return { tested: sent }
  }

  if (request.confirm !== 'SEND') throw new BroadcastError(400, 'confirm_required')
  const last = await deps.db.query<{ recent: boolean }>(
    `select exists (select 1 from private.email_broadcasts where created_at > now() - interval '10 minutes') as recent`,
  )
  if (last.rows[0]?.recent) throw new BroadcastError(429, 'cooldown')

  const created = await deps.db.query<{ id: string }>(
    `insert into private.email_broadcasts (created_by, audience, content) values ($1, $2, $3::jsonb) returning id`,
    [admin.id, request.audience, JSON.stringify(request.content)],
  )
  const broadcastId = created.rows[0]!.id
  const queued = await deps.db.query(
    `insert into private.email_outbox (kind, user_id, dedupe_key, payload)
     select 'broadcast', u.id, 'broadcast/' || $2 || '/' || u.id, jsonb_build_object('broadcast_id', $2::uuid)
     ${AUDIENCE_SQL}
     on conflict (dedupe_key) do nothing`,
    [request.audience, broadcastId],
  )
  await deps.db.query(`update private.email_broadcasts set recipients = $2 where id = $1`, [broadcastId, queued.rowCount ?? 0])
  return { broadcastId, queued: queued.rowCount ?? 0 }
}
