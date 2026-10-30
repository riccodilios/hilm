/**
 * /api/email-unsubscribe. GET shows a confirmation page (link scanners must not unsubscribe
 * people); POST — from that page's form or a mail client's RFC 8058 one-click — turns marketing
 * email off. The signed token covers only marketing; account and workspace email is unaffected.
 */
import { escapeHtml } from './text.ts'
import { verifyUnsubscribeToken } from './unsubscribe.ts'

const page = (status: number, title: { en: string; ar: string }, body: { en: string; ar: string }, form = '') =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title.en)} · Hilm</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Arabic',Arial,sans-serif">
<main style="max-width:440px;margin:24px;padding:32px 28px;border:1px solid #232326;border-radius:16px;background:#111113">
<p style="margin:0 0 18px;font-weight:600">Hilm · حلم</p>
<h1 style="margin:0 0 10px;font-size:20px">${escapeHtml(title.en)}</h1>
<p style="margin:0 0 22px;color:#b4b4bb;line-height:1.6">${escapeHtml(body.en)}</p>
<div dir="rtl" lang="ar"><h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(title.ar)}</h2>
<p style="margin:0 0 22px;color:#b4b4bb;line-height:1.7">${escapeHtml(body.ar)}</p></div>
${form}</main></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      },
    },
  )

const INVALID = page(
  400,
  { en: 'Link not valid', ar: 'الرابط غير صالح' },
  {
    en: 'This unsubscribe link is incomplete. You can turn off product news in Hilm → Settings → Notifications.',
    ar: 'رابط إلغاء الاشتراك غير مكتمل. يمكنك إيقاف أخبار المنتج من حلم ← الإعدادات ← الإشعارات.',
  },
)

export async function handleUnsubscribe(
  request: Request,
  deps: { secret: string | null; optOut: (userId: string) => Promise<void> },
): Promise<Response> {
  const url = new URL(request.url)
  if (url.searchParams.get('preview') === '1') {
    return page(200, { en: 'Preview', ar: 'معاينة' }, { en: 'Unsubscribe links work in sent emails.', ar: 'روابط إلغاء الاشتراك تعمل في الرسائل المرسلة.' })
  }
  const userId = url.searchParams.get('u')
  const token = url.searchParams.get('t')
  if (!deps.secret || !verifyUnsubscribeToken(deps.secret, userId, token)) {
    return request.method === 'POST' ? new Response('invalid', { status: 400 }) : INVALID.clone()
  }

  if (request.method === 'POST') {
    await deps.optOut(userId)
    return page(
      200,
      { en: "You're unsubscribed", ar: 'تم إلغاء اشتراكك' },
      {
        en: "You won't receive Hilm product news anymore. Reminders and workspace notifications are not affected; manage them in Settings.",
        ar: 'لن تصلك أخبار منتج حلم بعد الآن. التذكيرات وإشعارات مساحات العمل لا تتأثر؛ يمكنك إدارتها من الإعدادات.',
      },
    )
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const action = `${url.pathname}?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token!)}`
  return page(
    200,
    { en: 'Unsubscribe from product news?', ar: 'إلغاء الاشتراك في أخبار المنتج؟' },
    {
      en: 'Stop receiving Hilm announcements and product news by email.',
      ar: 'إيقاف استلام إعلانات حلم وأخبار المنتج عبر البريد.',
    },
    `<form method="post" action="${escapeHtml(action)}"><button type="submit" style="width:100%;padding:12px 18px;border:0;border-radius:10px;background:#f4f4f5;color:#0a0a0b;font-weight:600;font-size:14px;cursor:pointer">Unsubscribe · إلغاء الاشتراك</button></form>`,
  )
}
