#!/usr/bin/env node
/**
 * Notify IndexNow (Bing, Yandex, Seznam, Naver…) about changed public pages.
 *
 *   INDEXNOW_KEY=... npm run seo:indexnow                    every URL in the live sitemap
 *   INDEXNOW_KEY=... npm run seo:indexnow -- <url> [<url>]   only these (must be in the sitemap)
 *   INDEXNOW_KEY=... npm run seo:indexnow -- --removed <url> removed pages (must return 404/410)
 *
 * Only public hilm.tech URLs are ever sent. A 200/202 response means the notification was
 * accepted, not that anything was crawled or indexed.
 */
const ORIGIN = 'https://hilm.tech'
const key = (process.env.INDEXNOW_KEY ?? '').trim()
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  console.error('Set INDEXNOW_KEY (8-128 letters, digits or dashes); it must match the deployed key file.')
  process.exit(1)
}

const keyLocation = `${ORIGIN}/${key}.txt`
const published = await fetch(keyLocation).then((res) => (res.ok ? res.text() : ''))
if (published.trim() !== key) {
  console.error(`The key file ${ORIGIN}/<key>.txt is not deployed or does not match INDEXNOW_KEY.`)
  process.exit(1)
}

const sitemap = await fetch(`${ORIGIN}/sitemap.xml`).then((res) => res.text())
const publicUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))

const args = process.argv.slice(2)
const removed = args.includes('--removed')
const requested = args.filter((arg) => !arg.startsWith('--'))
let urls
if (removed) {
  urls = []
  for (const url of requested) {
    if (!url.startsWith(`${ORIGIN}/`)) throw new Error(`Not a public hilm.tech URL: ${url}`)
    const status = (await fetch(url, { redirect: 'manual' })).status
    if (status !== 404 && status !== 410) throw new Error(`${url} still returns ${status}; only removed pages can be submitted`)
    urls.push(url)
  }
} else {
  urls = requested.length ? requested : [...publicUrls]
  for (const url of urls) if (!publicUrls.has(url)) throw new Error(`Not in the public sitemap: ${url}`)
}
if (!urls.length) {
  console.error('Nothing to submit.')
  process.exit(1)
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(ORIGIN).host, key, keyLocation, urlList: urls }),
})
console.log(`IndexNow responded ${response.status} for ${urls.length} URL(s)${removed ? ' (removed)' : ''}.`)
if (response.status >= 400) {
  console.error(await response.text())
  process.exit(1)
}
console.log('Accepted for processing; this does not mean the pages were crawled or indexed.')
