#!/usr/bin/env node
/**
 * Renders the Hilm mark (public/favicon.svg) into raster favicons with a local Chromium:
 *   public/favicon.ico            16, 32 and 48 px (PNG-compressed ICO)
 *   public/favicon-48x48.png      Google Search favicon (multiple of 48 px)
 *   public/favicon-96x96.png
 *   public/favicon-192x192.png
 *
 *   npm run seo:favicons          (set BROWSER_PATH if Edge/Chrome is not in a default location)
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

const svg = fs.readFileSync(path.join(ROOT, 'public', 'favicon.svg'), 'utf8')
const page = (size) =>
  `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`

/** ICO container holding PNG images (supported by every current browser and crawler). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt8(0, at + 2)
    header.writeUInt8(0, at + 3)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(data.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...pngs.map((p) => p.data)])
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hilm-fav-'))
const port = 9400 + Math.floor(Math.random() * 400)
const browser = spawn(
  browserPath,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'],
  { stdio: 'ignore' },
)
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
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })

  const rendered = new Map()
  for (const size of [16, 32, 48, 96, 192]) {
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(page(size))}` })
    await sleep(500)
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } })
    rendered.set(size, Buffer.from(shot.result.data, 'base64'))
  }
  ws.close()

  for (const size of [48, 96, 192]) {
    fs.writeFileSync(path.join(ROOT, 'public', `favicon-${size}x${size}.png`), rendered.get(size))
    console.log(`wrote public/favicon-${size}x${size}.png`)
  }
  fs.writeFileSync(path.join(ROOT, 'public', 'favicon.ico'), ico([16, 32, 48].map((size) => ({ size, data: rendered.get(size) }))))
  console.log('wrote public/favicon.ico (16, 32, 48)')
} finally {
  browser.kill()
}
