import { describe, expect, it, vi } from 'vitest'
import { broadcastRequestSchema, handleBroadcast } from './broadcasts.ts'
import { loadEmailConfig } from './config.ts'
import { fakeDb } from './fake-db.test-helper.ts'
import { allowedImageUrl, assetKey, sniffImage } from './images.ts'
import type { EmailService, SendInput } from './service.ts'
import { broadcastEmail, broadcastParagraphs } from './templates-engagement.ts'

const APP = 'https://app.hilm.tech'
const KEY = `${'a'.repeat(64)}.png`
const IMG = `${APP}/email-assets/${KEY}`
const config = loadEmailConfig({ RESEND_API_KEY: 're_test', EMAIL_UNSUBSCRIBE_SECRET: 's'.repeat(40) })

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const GIF = new TextEncoder().encode('GIF89a......')
const WEBP = new TextEncoder().encode('RIFF....WEBPVP8 ')
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

describe('sniffImage', () => {
  it('detects raster formats from bytes and refuses everything else', () => {
    expect(sniffImage(PNG)?.ext).toBe('png')
    expect(sniffImage(JPEG)?.ext).toBe('jpg')
    expect(sniffImage(GIF)?.ext).toBe('gif')
    expect(sniffImage(WEBP)?.ext).toBe('webp')
    expect(sniffImage(SVG)).toBeNull()
    expect(sniffImage(new TextEncoder().encode('<html>'))).toBeNull()
  })

  it('names assets by content hash', () => {
    expect(assetKey(PNG, 'png')).toMatch(/^[a-f0-9]{64}\.png$/)
  })
})

describe('allowedImageUrl', () => {
  it('accepts only uploaded assets on the app origin', () => {
    expect(allowedImageUrl(IMG, APP)).toBe(true)
    expect(allowedImageUrl(`https://evil.example/email-assets/${KEY}`, APP)).toBe(false)
    expect(allowedImageUrl(`http://app.hilm.tech/email-assets/${KEY}`, APP)).toBe(false)
    expect(allowedImageUrl(`${APP}/email-assets/${KEY}?track=1`, APP)).toBe(false)
    expect(allowedImageUrl(`${APP}/email-assets/x.svg`, APP)).toBe(false)
    expect(allowedImageUrl(`${APP}/other/${KEY}`, APP)).toBe(false)
  })
})

describe('broadcast images', () => {
  it('renders the header image and image paragraphs; other syntax stays text', () => {
    const paragraphs = broadcastParagraphs(`Intro\n\n![Team photo](${IMG})\n\n![remote](https://evil.example/a.png)`, APP)
    expect(paragraphs).toEqual([
      { kind: 'p', inlines: [{ text: 'Intro' }] },
      { image: IMG, alt: 'Team photo' },
      // Not an uploaded asset: stays literal text ("!" + a normal link to the URL).
      { kind: 'p', inlines: [{ text: '!' }, { text: 'remote', href: 'https://evil.example/a.png', bold: false }] },
    ])

    const email = broadcastEmail({
      locale: 'en',
      appBaseUrl: APP,
      content: { subject: 'S', heading: 'H', body: `Hi\n\n![Chart](${IMG})`, heroImage: { url: IMG, alt: 'Banner' } },
      unsubscribeUrl: `${APP}/api/email-unsubscribe?preview=1`,
    })
    expect(email.html.match(/<img /g)).toHaveLength(2)
    expect(email.html).toContain('alt="Banner"')
    expect(email.text).toContain('[Chart]')
  })

  it('rejects images that were not uploaded through the console', async () => {
    const send = vi.fn()
    const service: EmailService = { enabled: true, send }
    const body = (content: Record<string, unknown>) =>
      broadcastRequestSchema.parse({ action: 'preview', content: { en: { subject: 'S', heading: 'H', body: 'B', ...content } } })
    await expect(
      handleBroadcast(body({ heroImage: { url: 'https://evil.example/x.png' } }), { id: 'a', email: 'a@hilm.tech' }, { db: fakeDb([]), service, config }),
    ).rejects.toMatchObject({ code: 'image_url_not_allowed' })
    await expect(
      handleBroadcast(body({ body: '![x](https://evil.example/x.png)' }), { id: 'a', email: 'a@hilm.tech' }, { db: fakeDb([]), service, config }),
    ).rejects.toMatchObject({ code: 'image_url_not_allowed' })
  })
})

describe('message formatting', () => {
  it('supports titles, subtitles, bold and links', () => {
    const blocks = broadcastParagraphs('# Big news\n\n## What changed\n\nThis is *really* fast. Read [the guide](https://hilm.tech/features) or email [us](mailto:info@hilm.tech).', APP)
    expect(blocks).toEqual([
      { kind: 'h2', inlines: [{ text: 'Big news' }] },
      { kind: 'h3', inlines: [{ text: 'What changed' }] },
      {
        kind: 'p',
        inlines: [
          { text: 'This is ' },
          { text: 'really', bold: true },
          { text: ' fast. Read ' },
          { text: 'the guide', href: 'https://hilm.tech/features', bold: false },
          { text: ' or email ' },
          { text: 'us', href: 'mailto:info@hilm.tech', bold: false },
          { text: '.' },
        ],
      },
    ])
  })

  it('never turns unsafe links into anchors and escapes everything', () => {
    const email = broadcastEmail({
      locale: 'en',
      appBaseUrl: APP,
      content: {
        subject: 'S',
        heading: 'H',
        body: '# <script>x</script>\n\n[click](javascript:alert(1)) [plain](http://insecure.example) **<b>bold</b>**',
      },
      unsubscribeUrl: `${APP}/api/email-unsubscribe?preview=1`,
    })
    // Unsafe links stay inert literal text, never an href.
    expect(email.html).not.toContain('href="javascript:')
    expect(email.html).toContain('[click](javascript:alert(1))')
    expect(email.html).not.toContain('href="http://')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;x&lt;/script&gt;</h2>')
    expect(email.html).toContain('<strong style="font-weight:600;color:#f4f4f5;">&lt;b&gt;bold&lt;/b&gt;</strong>')
    expect(email.text).toContain('<SCRIPT>X</SCRIPT>')
  })

  it('renders links in the plain-text part with their address', () => {
    const email = broadcastEmail({
      locale: 'en',
      appBaseUrl: APP,
      content: { subject: 'S', heading: 'H', body: 'See [features](https://hilm.tech/features).' },
      unsubscribeUrl: `${APP}/api/email-unsubscribe?preview=1`,
    })
    expect(email.text).toContain('See features (https://hilm.tech/features).')
    expect(email.html).toContain('<a href="https://hilm.tech/features"')
  })
})

describe('admin-only send', () => {
  it('sends the final email (no [Test]) only to the admin and records it', async () => {
    const sends: SendInput[] = []
    const service: EmailService = {
      enabled: true,
      send: vi.fn(async (input: SendInput) => {
        sends.push(input)
        return { ok: true as const, id: 'msg' }
      }),
    }
    const db = fakeDb([[/insert into private\.email_broadcasts/, () => ({ rows: [{ id: 'b1' }] })]])
    const res = await handleBroadcast(
      broadcastRequestSchema.parse({
        action: 'send',
        audience: 'admin',
        confirm: 'SEND',
        content: { en: { subject: 'Launch', heading: 'H', body: 'B' }, ar: { subject: 'إطلاق', heading: 'H', body: 'B' } },
      }),
      { id: '11111111-1111-4111-8111-111111111111', email: 'owner@hilm.tech' },
      { db, service, config },
    )
    expect(res).toMatchObject({ queued: 1, sentToAdmin: 2 })
    expect(sends.map((s) => [s.to, s.subject])).toEqual([
      ['owner@hilm.tech', 'Launch'],
      ['owner@hilm.tech', 'إطلاق'],
    ])
    expect(db.calls.some((c) => /insert into private\.email_outbox/.test(c.sql))).toBe(false)
    expect(sends[0]!.headers?.['List-Unsubscribe']).toBeTruthy()
  })
})
