#!/usr/bin/env node
/**
 * Renders Hilm's social preview images with a local Chromium (Edge or Chrome, headless):
 *   public/og-image.png     1200×630  English Open Graph / X card
 *   public/og-image-ar.png  1200×630  Arabic Open Graph / X card
 *   public/og-square.png    1080×1080 square social asset
 *
 *   npm run seo:images            (set BROWSER_PATH if Edge/Chrome is not in a default location)
 *
 * Monochrome brand only (black, white, graphite) and the existing logo mark; no product
 * screenshots are invented.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const browserPath = CANDIDATES.find((candidate) => fs.existsSync(candidate))
if (!browserPath) throw new Error('No Chromium found; set BROWSER_PATH')

const MARK = `<svg viewBox="0 0 128 128" width="64" height="64" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#f4f4f5"/><path d="M38 34h18v24h16V34h18v60H72V74H56v20H38V34z" fill="#0a0a0b"/></svg>`

function template({ width, height, lang, wordmark, title, chips, square }) {
  const rtl = lang === 'ar'
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  html,body{width:${width}px;height:${height}px;background:#0a0a0b;overflow:hidden}
  body{font-family:${rtl ? "'Segoe UI','Noto Sans Arabic','Geeza Pro',sans-serif" : "'Inter','Segoe UI','Helvetica Neue',Arial,sans-serif"};color:#f4f4f5;
    background:radial-gradient(1100px 620px at ${rtl ? '15%' : '85%'} 0%,rgba(255,255,255,.09),transparent 60%),radial-gradient(900px 500px at ${rtl ? '100%' : '0%'} 100%,rgba(255,255,255,.05),transparent 60%),#0a0a0b;
    padding:${square ? 96 : 80}px;display:flex;flex-direction:column;justify-content:space-between}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(circle at 50% 40%,#000 0%,transparent 75%)}
  .top,.bottom{position:relative;display:flex;align-items:center;justify-content:space-between}
  .domain{font-size:26px;color:#a1a1aa;letter-spacing:.01em}
  .center{position:relative}
  .wordmark{font-size:${square ? 200 : 150}px;font-weight:600;letter-spacing:${rtl ? '0' : '-.055em'};line-height:${rtl ? 1.2 : 0.95}}
  .title{margin-top:${square ? 32 : rtl ? 40 : 22}px;font-size:${square ? 52 : 44}px;font-weight:500;color:#e4e4e7;letter-spacing:${rtl ? '0' : '-.02em'};max-width:${square ? 860 : 980}px;line-height:1.2}
  .chips{display:flex;flex-wrap:wrap;gap:14px}
  .chip{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#d4d4d8;border-radius:999px;padding:12px 24px;font-size:24px}
</style></head><body><div class="grid"></div>
  <div class="top">${MARK}<span class="domain" dir="ltr">hilm.tech</span></div>
  <div class="center"><div class="wordmark">${wordmark}</div><div class="title">${title}</div></div>
  <div class="bottom"><div class="chips">${chips.map((chip) => `<span class="chip">${chip}</span>`).join('')}</div></div>
</body></html>`
}

const IMAGES = [
  {
    file: 'og-image.png',
    width: 1200,
    height: 630,
    lang: 'en',
    wordmark: 'Hilm',
    title: 'Your Personal &amp; Workspace OS',
    chips: ['Personal OS', 'Workspace OS', 'AI meeting notes'],
  },
  {
    file: 'og-image-ar.png',
    width: 1200,
    height: 630,
    lang: 'ar',
    wordmark: 'حلم',
    title: 'نظام تشغيلك الشخصي ونظام تشغيل فريقك',
    chips: ['Personal OS', 'Workspace OS', 'محاضر الاجتماعات'],
  },
  {
    file: 'og-square.png',
    width: 1080,
    height: 1080,
    lang: 'en',
    wordmark: 'Hilm',
    title: 'Your Personal &amp; Workspace Operating System',
    chips: ['Personal OS', 'Workspace OS', 'AI meeting notes'],
    square: true,
  },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hilm-og-'))
const port = 9400 + Math.floor(Math.random() * 400)
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })
try {
  let target
  for (let i = 0; i < 75 && !target; i += 1) {
    await sleep(200)
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((entry) => entry.type === 'page')
    } catch {}
  }
  if (!target) throw new Error('Browser did not start')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) pending.get(message.id)(message)
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Page.enable')
  for (const image of IMAGES) {
    await send('Emulation.setDeviceMetricsOverride', { width: image.width, height: image.height, deviceScaleFactor: 1, mobile: false })
    const html = template(image)
    await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` })
    await sleep(1200)
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: image.width, height: image.height, scale: 1 } })
    fs.writeFileSync(path.join(ROOT, 'public', image.file), Buffer.from(shot.result.data, 'base64'))
    console.log(`wrote public/${image.file} (${image.width}×${image.height})`)
  }
  ws.close()
} finally {
  browser.kill()
}
