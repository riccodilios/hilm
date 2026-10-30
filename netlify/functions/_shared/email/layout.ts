/**
 * Shared Hilm email layout. Table-based with inline styles so it renders in Gmail, Outlook and
 * Apple Mail; dark monochrome to match the product. Every string passed in is treated as plain
 * text and escaped here, and every email gets a matching plain-text part.
 */
import { escapeHtml, singleLine } from './text.ts'

export type EmailLocale = 'en' | 'ar'

export type EmailImage = { image: string; alt: string }

/** Inline run of text; href is only set from a validated URL (templates-engagement.ts). */
export type Inline = { text: string; bold?: boolean; href?: string }
/** Formatted paragraph: body text, title (h2) or subtitle (h3). */
export type RichBlock = { kind: 'p' | 'h2' | 'h3'; inlines: Inline[] }

type Paragraph = string | EmailImage | RichBlock

const isImage = (p: Paragraph): p is EmailImage => typeof p === 'object' && 'image' in p
const isRich = (p: Paragraph): p is RichBlock => typeof p === 'object' && 'inlines' in p

export type EmailContent = {
  locale: EmailLocale
  /** Inbox preview line. */
  preheader: string
  eyebrow?: string
  heading: string
  /** Text paragraphs; image blocks are only produced from validated asset URLs (images.ts). */
  paragraphs: Paragraph[]
  /** Full-width image above the heading. */
  hero?: EmailImage
  /** One-time code shown large (verification emails). */
  code?: { label: string; value: string }
  quote?: string
  details?: Array<{ label: string; value: string }>
  items?: Array<{ title: string; meta?: string; url?: string }>
  action?: { label: string; url: string }
  /** Small print under the action (e.g. "If this wasn't you..."). */
  note?: string
  footer: {
    reason: string
    manage?: { label: string; url: string }
    unsubscribe?: { label: string; url: string }
  }
}

const C = {
  page: '#0a0a0b',
  card: '#111113',
  border: '#232326',
  rule: '#1d1d20',
  text: '#f4f4f5',
  body: '#b4b4bb',
  muted: '#7c7c85',
  buttonBg: '#f4f4f5',
  buttonText: '#0a0a0b',
}

const BRAND = { en: 'Hilm', ar: 'حلم' } as const
const TAGLINE = {
  en: 'Your Personal and Workspace OS',
  ar: 'نظام تشغيلك الشخصي ونظام تشغيل فريقك',
} as const
const OPEN_FALLBACK = {
  en: 'If the button does not work, open this link:',
  ar: 'إن لم يعمل الزر، افتح هذا الرابط:',
} as const

function fontStack(locale: EmailLocale) {
  return locale === 'ar'
    ? `'Noto Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif`
    : `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
}

export function renderEmailHtml(content: EmailContent) {
  const { locale } = content
  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  const align = locale === 'ar' ? 'right' : 'left'
  const font = fontStack(locale)
  const e = escapeHtml

  const image = (img: EmailImage, margin: string) =>
    `<img src="${e(img.image)}" alt="${e(img.alt)}" width="504" style="display:block;width:100%;max-width:504px;height:auto;margin:${margin};border:0;border-radius:12px;" />`
  const inlines = (runs: Inline[]) =>
    runs
      .map((run) => {
        let html = e(run.text)
        if (run.bold) html = `<strong style="font-weight:600;color:${C.text};">${html}</strong>`
        if (run.href) html = `<a href="${e(run.href)}" style="color:${C.text};text-decoration:underline;">${html}</a>`
        return html
      })
      .join('')
  const rich = (block: RichBlock) => {
    if (block.kind === 'h2') {
      return `<h2 style="margin:24px 0 10px;font-size:20px;line-height:1.35;font-weight:600;color:${C.text};">${inlines(block.inlines)}</h2>`
    }
    if (block.kind === 'h3') {
      return `<h3 style="margin:20px 0 8px;font-size:17px;line-height:1.4;font-weight:600;color:${C.text};">${inlines(block.inlines)}</h3>`
    }
    return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.body};">${inlines(block.inlines)}</p>`
  }
  const paragraphs = content.paragraphs
    .map((p) =>
      isImage(p)
        ? image(p, '6px 0 18px')
        : isRich(p)
          ? rich(p)
          : `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.body};">${e(p)}</p>`,
    )
    .join('')
  const hero = content.hero ? image(content.hero, '0 0 22px') : ''

  const code = content.code
    ? `<p style="margin:8px 0 6px;font-size:12px;letter-spacing:${locale === 'ar' ? '0' : '0.08em'};text-transform:uppercase;color:${C.muted};">${e(content.code.label)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr><td dir="ltr" style="padding:14px 22px;border:1px solid ${C.border};border-radius:12px;background:#0d0d0f;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:30px;font-weight:600;letter-spacing:0.28em;color:${C.text};" bgcolor="#0d0d0f">${e(content.code.value)}</td></tr></table>`
    : ''

  const quoteBorder = locale === 'ar' ? 'border-right' : 'border-left'
  const quotePad = locale === 'ar' ? 'padding-right' : 'padding-left'
  const quote = content.quote
    ? `<p style="margin:4px 0 18px;${quoteBorder}:2px solid #3a3a40;${quotePad}:14px;font-size:14px;line-height:1.6;color:#d4d4d8;">${e(content.quote)}</p>`
    : ''

  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;border-collapse:collapse;">${content.details
        .map(
          (row) =>
            `<tr><td style="padding:11px 0;border-top:1px solid ${C.rule};width:34%;font-size:13px;color:${C.muted};vertical-align:top;" align="${align}">${e(row.label)}</td><td style="padding:11px 0;border-top:1px solid ${C.rule};font-size:14px;color:${C.text};font-weight:500;vertical-align:top;" align="${align}">${e(row.value)}</td></tr>`,
        )
        .join('')}</table>`
    : ''

  const items = content.items?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;border-collapse:collapse;">${content.items
        .map((item) => {
          const title = item.url
            ? `<a href="${e(item.url)}" style="color:${C.text};text-decoration:none;font-weight:500;">${e(item.title)}</a>`
            : `<span style="color:${C.text};font-weight:500;">${e(item.title)}</span>`
          const meta = item.meta
            ? `<div style="margin-top:3px;font-size:13px;color:${C.muted};">${e(item.meta)}</div>`
            : ''
          return `<tr><td style="padding:12px 0;border-top:1px solid ${C.rule};font-size:14px;line-height:1.5;" align="${align}">${title}${meta}</td></tr>`
        })
        .join('')}</table>`
    : ''

  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr><td style="border-radius:10px;background:${C.buttonBg};" bgcolor="${C.buttonBg}"><a href="${e(content.action.url)}" style="display:inline-block;padding:12px 22px;font-family:${font};font-size:14px;font-weight:600;color:${C.buttonText};text-decoration:none;border-radius:10px;">${e(content.action.label)}</a></td></tr></table>
<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:${C.muted};">${e(OPEN_FALLBACK[locale])}<br /><a href="${e(content.action.url)}" style="color:${C.muted};text-decoration:underline;word-break:break-all;">${e(content.action.url)}</a></p>`
    : ''

  const note = content.note
    ? `<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid ${C.rule};font-size:13px;line-height:1.6;color:${C.muted};">${e(content.note)}</p>`
    : ''

  const eyebrow = content.eyebrow
    ? `<p style="margin:0 0 10px;font-size:12px;letter-spacing:${locale === 'ar' ? '0' : '0.08em'};text-transform:uppercase;color:${C.muted};">${e(content.eyebrow)}</p>`
    : ''

  const footerLinks = [content.footer.manage, content.footer.unsubscribe]
    .filter((link): link is { label: string; url: string } => Boolean(link))
    .map((link) => `<a href="${e(link.url)}" style="color:${C.muted};text-decoration:underline;">${e(link.label)}</a>`)
  const manage = footerLinks.length ? `<br />${footerLinks.join(' · ')}` : ''

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${e(singleLine(content.heading))}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};" bgcolor="${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};font-size:1px;line-height:1px;">${e(singleLine(content.preheader, 140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;font-family:${font};">
<tr><td align="center" style="padding:4px 4px 22px;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:${C.text};">${e(BRAND[locale])}</td></tr>
<tr><td align="${align}" style="background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:32px 28px;" bgcolor="${C.card}">
${hero}${eyebrow}<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:600;color:${C.text};">${e(content.heading)}</h1>
${paragraphs}${code}${quote}${details}${items}${action}${note}
</td></tr>
<tr><td align="${align}" style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:${C.muted};">${e(content.footer.reason)}${manage}<br /><br />${e(BRAND[locale])} · ${e(TAGLINE[locale])}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

export function renderEmailText(content: EmailContent) {
  const lines: string[] = [BRAND[content.locale], '', content.heading, '']
  for (const p of content.paragraphs) {
    if (isImage(p)) lines.push(`[${p.alt || 'Image'}]`, '')
    else if (isRich(p)) {
      const text = p.inlines.map((run) => (run.href && run.href !== run.text ? `${run.text} (${run.href})` : run.text)).join('')
      lines.push(p.kind === 'h2' ? text.toUpperCase() : text, '')
    } else lines.push(p, '')
  }
  if (content.code) lines.push(`${content.code.label}: ${content.code.value}`, '')
  if (content.quote) lines.push(`> ${content.quote}`, '')
  if (content.details?.length) {
    for (const row of content.details) lines.push(`${row.label}: ${row.value}`)
    lines.push('')
  }
  if (content.items?.length) {
    for (const item of content.items) {
      lines.push(`- ${item.title}${item.meta ? ` (${item.meta})` : ''}`)
      if (item.url) lines.push(`  ${item.url}`)
    }
    lines.push('')
  }
  if (content.action) lines.push(`${content.action.label}: ${content.action.url}`, '')
  if (content.note) lines.push(content.note, '')
  lines.push('---', content.footer.reason)
  if (content.footer.manage) lines.push(`${content.footer.manage.label}: ${content.footer.manage.url}`)
  if (content.footer.unsubscribe) lines.push(`${content.footer.unsubscribe.label}: ${content.footer.unsubscribe.url}`)
  lines.push(`${BRAND[content.locale]} · ${TAGLINE[content.locale]}`)
  return lines.join('\n')
}

export function renderEmail(content: EmailContent) {
  return { html: renderEmailHtml(content), text: renderEmailText(content) }
}
