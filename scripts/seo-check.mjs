#!/usr/bin/env node
/**
 * SEO / AI-discoverability health checks.
 *
 *   npm run seo:check         validate the built site in dist/ (offline; runs in every build)
 *   npm run seo:check:live    validate the deployed domains over HTTPS (no search-engine calls)
 *
 * Fails with exit code 1 on any problem.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PAGE_META,
  PUBLIC_LOCALES,
  PUBLIC_PAGE_IDS,
  SITE,
  publicPath,
  publicUrl,
} from '../src/content/site.ts'
import { pageFaq } from '../src/content/structured-data.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const OLD_DOMAIN = 'hillm.netlify.app'
const PRIVATE_ROOTS = ['/personal', '/workspace', '/app', '/auth', '/onboarding', '/shared', '/api', '/login', '/signup']
const isPrivatePath = (pathname) => PRIVATE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`))
const FORBIDDEN_SCHEMA = ['aggregateRating', 'review', 'offers', 'award', 'ratingValue']

const problems = []
let checks = 0
const check = (ok, message) => {
  checks += 1
  if (!ok) problems.push(message)
}

const pages = PUBLIC_LOCALES.flatMap((locale) => PUBLIC_PAGE_IDS.map((id) => ({ id, locale, url: publicUrl(id, locale) })))

// ── HTML helpers (the prerender output is predictable, so regexes suffice) ──

const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null
const metaContent = (html, key) => {
  const tag = html.match(new RegExp(`<meta (?:name|property)="${key}" content="[^"]*"[^>]*>`))?.[0]
  return tag ? attr(tag, 'content') : null
}
const decode = (value) =>
  value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

function inspectPage(html, page, label) {
  const { id, locale, url } = page
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => decode(m[1]))
  check(titles.length === 1, `${label}: expected one <title>, found ${titles.length}`)
  const title = titles[0] ?? ''
  check(title === PAGE_META[id][locale].title, `${label}: title does not match content (${title})`)
  check(title.length >= 15 && title.length <= 75, `${label}: title length ${title.length} outside 15–75`)

  const description = decode(metaContent(html, 'description') ?? '')
  check(description.length >= 70 && description.length <= 200, `${label}: description length ${description.length} outside 70–200`)

  const robots = metaContent(html, 'robots') ?? ''
  check(robots.includes('index') && !robots.includes('noindex'), `${label}: robots meta must allow indexing (${robots})`)

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
  check(canonical === url, `${label}: canonical ${canonical} should be ${url}`)
  check(canonical?.startsWith(`${SITE.origin}/`), `${label}: canonical must use ${SITE.origin}`)

  for (const lang of ['en', 'ar', 'x-default']) {
    const href = html.match(new RegExp(`<link rel="alternate" hreflang="${lang}" href="([^"]+)"`))?.[1]
    check(href === publicUrl(id, lang === 'x-default' ? 'en' : lang), `${label}: hreflang ${lang} is ${href}`)
  }

  const htmlTag = html.match(/<html[^>]*>/)?.[0] ?? ''
  check(attr(htmlTag, 'lang') === locale, `${label}: <html lang> should be ${locale}`)
  check(attr(htmlTag, 'dir') === (locale === 'ar' ? 'rtl' : 'ltr'), `${label}: <html dir> is wrong`)

  for (const key of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:locale', 'twitter:card', 'twitter:image']) {
    check(Boolean(metaContent(html, key)), `${label}: missing ${key}`)
  }
  check(metaContent(html, 'og:url') === url, `${label}: og:url should be ${url}`)
  check((metaContent(html, 'og:image') ?? '').startsWith(`${SITE.origin}/`), `${label}: og:image must be absolute on ${SITE.origin}`)

  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  check(scripts.length === 1, `${label}: expected one JSON-LD block, found ${scripts.length}`)
  try {
    const data = JSON.parse(scripts[0]?.[1] ?? 'null')
    const graph = data?.['@graph'] ?? []
    const types = graph.map((node) => node['@type'])
    for (const type of ['Organization', 'WebSite', 'SoftwareApplication', 'WebPage']) {
      check(types.includes(type), `${label}: JSON-LD missing ${type}`)
    }
    const ids = graph.map((node) => node['@id'])
    check(new Set(ids).size === ids.length, `${label}: duplicate JSON-LD @id`)
    const raw = JSON.stringify(data)
    for (const key of FORBIDDEN_SCHEMA) check(!raw.includes(`"${key}"`), `${label}: JSON-LD must not contain ${key}`)
    const faq = graph.find((node) => node['@type'] === 'FAQPage')
    const visibleFaq = pageFaq(id, locale)
    check((faq?.mainEntity?.length ?? 0) === visibleFaq.length, `${label}: FAQ schema must match the visible FAQ`)
    for (const item of visibleFaq) check(html.includes(item.q.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')), `${label}: FAQ question not visible: ${item.q}`)
    if (id !== 'home') check(types.includes('BreadcrumbList'), `${label}: JSON-LD missing BreadcrumbList`)
  } catch (error) {
    check(false, `${label}: invalid JSON-LD (${error.message})`)
  }

  const content = html.match(/<div class="hilm-prerender">([\s\S]*?)<\/div><\/div>/)?.[1] ?? ''
  check(content.length > 1500, `${label}: prerendered content is missing or thin (${content.length} chars)`)
  const h1s = content.match(/<h1[\s>]/g) ?? []
  check(h1s.length === 1, `${label}: expected one <h1>, found ${h1s.length}`)
  if (id !== 'privacy') check((content.match(/<h2[\s>]/g) ?? []).length >= 3, `${label}: expected at least three <h2> sections`)

  for (const match of content.matchAll(/href="([^"]+)"/g)) {
    const href = match[1]
    if (href.startsWith('mailto:')) continue
    const u = new URL(href)
    if (u.origin === SITE.origin) {
      const known = pages.some((p) => p.url === href)
      check(known, `${label}: internal link to unknown page ${href}`)
    } else if (u.origin === SITE.appOrigin) {
      check(['/login', '/signup'].includes(u.pathname), `${label}: public page links into a private app route ${href}`)
    } else {
      check(false, `${label}: unexpected external link ${href}`)
    }
  }
  check(!html.includes(OLD_DOMAIN), `${label}: references the old domain ${OLD_DOMAIN}`)
  for (const prefix of ['/personal/', '/workspace/', '/shared/meeting']) {
    check(!content.includes(`${SITE.origin}${prefix}`), `${label}: exposes a private route (${prefix})`)
  }
  return { title, description }
}

function checkRobots(text, label) {
  check(text.includes(`Sitemap: ${SITE.origin}/sitemap.xml`), `${label}: missing Sitemap line`)
  for (const agent of ['OAI-SearchBot', 'GPTBot', 'ChatGPT-User', 'Googlebot', 'Bingbot']) {
    check(new RegExp(`^User-agent: ${agent}$`, 'm').test(text), `${label}: no explicit group for ${agent}`)
  }
  // Groups are blank-line separated; consecutive User-agent lines share one group.
  const groups = text
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').filter((line) => !line.startsWith('#')).join('\n').trim())
    .filter((group) => group.startsWith('User-agent:'))
  for (const group of groups) {
    const name = group.split('\n').filter((line) => line.startsWith('User-agent:')).join(', ')
    check(/^Disallow: \/personal\/$/m.test(group) && /^Disallow: \/workspace\/$/m.test(group), `${label}: ${name} group must block private routes`)
    check(!/^Disallow: \/$/m.test(group), `${label}: ${name} group blocks the whole public site`)
    check(!/^Disallow: \/assets/m.test(group), `${label}: ${name} group blocks rendering assets`)
  }
}

function checkSitemap(xml, label) {
  check(xml.startsWith('<?xml') && xml.includes('<urlset'), `${label}: not a sitemap urlset`)
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  check(locs.length === pages.length, `${label}: expected ${pages.length} URLs, found ${locs.length}`)
  check(new Set(locs).size === locs.length, `${label}: duplicate URLs`)
  for (const loc of locs) {
    check(pages.some((p) => p.url === loc), `${label}: unexpected URL ${loc}`)
    check(!isPrivatePath(new URL(loc).pathname), `${label}: private URL ${loc}`)
  }
  for (const lastmod of [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1])) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(lastmod) && !Number.isNaN(Date.parse(lastmod)), `${label}: invalid lastmod ${lastmod}`)
  }
  check((xml.match(/hreflang="x-default"/g) ?? []).length === pages.length, `${label}: every URL needs hreflang alternates`)
}

// ── Offline: dist/ ──────────────────────────────────────────────────────────

function offline() {
  check(fs.existsSync(DIST), 'dist/ not found — run the build first')
  if (!fs.existsSync(DIST)) return
  const read = (file) => fs.readFileSync(path.join(DIST, file), 'utf8')
  const seen = { titles: new Map(), descriptions: new Map() }
  for (const page of pages) {
    const file = path.join('_public', page.locale, `${page.id}.html`)
    const label = `${publicPath(page.id, page.locale)} (${file})`
    if (!fs.existsSync(path.join(DIST, file))) {
      check(false, `${label}: prerendered file missing`)
      continue
    }
    const { title, description } = inspectPage(read(file), page, label)
    check(!seen.titles.has(title), `${label}: duplicate title with ${seen.titles.get(title)}`)
    check(!seen.descriptions.has(description), `${label}: duplicate description with ${seen.descriptions.get(description)}`)
    seen.titles.set(title, label)
    seen.descriptions.set(description, label)
  }

  const shell = read('index.html')
  check(/<meta name="robots" content="noindex/.test(shell), 'index.html (app shell) must be noindex')
  check(!shell.includes('application/ld+json'), 'index.html (app shell) must not carry public structured data')

  checkRobots(read('robots.txt'), 'robots.txt')
  const appRobots = read('robots-app.txt')
  check(/^Disallow: \/$/m.test(appRobots), 'robots-app.txt must disallow the app')
  checkSitemap(read('sitemap.xml'), 'sitemap.xml')

  for (const file of ['llms.txt', 'llms-full.txt']) {
    const text = read(file)
    check(text.startsWith('# Hilm'), `${file}: must start with "# Hilm"`)
    check(text.includes(`${SITE.origin}/`), `${file}: must reference ${SITE.origin}`)
    check(!text.includes(OLD_DOMAIN), `${file}: references the old domain`)
    for (const prefix of ['/personal/', '/workspace/', '/shared/']) check(!text.includes(prefix), `${file}: mentions private route ${prefix}`)
  }

  const redirects = read('_redirects')
  check(redirects.includes(`${SITE.origin}/  /_public/en/home.html  200!`), '_redirects: homepage rewrite missing')
  check(redirects.includes('https://app.hilm.tech/robots.txt  /robots-app.txt  200!'), '_redirects: app robots rule missing')
  for (const page of pages) {
    if (page.id === 'home' && page.locale === 'en') continue
    check(redirects.includes(`${publicPath(page.id, page.locale)}  /_public/${page.locale}/${page.id}.html  200`), `_redirects: rewrite missing for ${page.url}`)
  }

  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8')
  for (const route of ['/personal/*', '/workspace/*', '/shared/*', '/auth/*']) {
    check(new RegExp(`for = "${route.replace(/[/*]/g, '\\$&')}"\\s*\\n\\s*\\[headers\\.values\\]\\s*\\n\\s*X-Robots-Tag = "noindex`).test(toml), `netlify.toml: ${route} needs an X-Robots-Tag noindex header`)
  }
}

// ── Live: deployed domains ──────────────────────────────────────────────────

async function live(base) {
  const get = (url, init = {}) => fetch(url, { redirect: 'manual', ...init, headers: { 'user-agent': 'hilm-seo-check/1.0', ...(init.headers ?? {}) } })
  const seen = new Set()
  for (const page of pages) {
    const url = `${base}${publicPath(page.id, page.locale)}`
    const res = await get(url)
    const label = `LIVE ${url}`
    check(res.status === 200, `${label}: HTTP ${res.status}`)
    check(!(res.headers.get('x-robots-tag') ?? '').includes('noindex'), `${label}: X-Robots-Tag noindex on a public page`)
    if (res.status !== 200) continue
    const { title } = inspectPage(await res.text(), page, label)
    check(!seen.has(title), `${label}: duplicate title`)
    seen.add(title)
  }

  const text = async (url, label, type) => {
    const res = await get(url)
    check(res.status === 200, `${label}: HTTP ${res.status}`)
    if (type) check((res.headers.get('content-type') ?? '').includes(type), `${label}: content-type ${res.headers.get('content-type')}`)
    return res.status === 200 ? res.text() : ''
  }
  checkRobots(await text(`${base}/robots.txt`, 'LIVE robots.txt', 'text/plain'), 'LIVE robots.txt')
  checkSitemap(await text(`${base}/sitemap.xml`, 'LIVE sitemap.xml', 'xml'), 'LIVE sitemap.xml')
  await text(`${base}/llms.txt`, 'LIVE llms.txt', 'text/plain')
  await text(`${base}/llms-full.txt`, 'LIVE llms-full.txt', 'text/plain')
  for (const image of ['/og-image.png', '/og-image-ar.png']) {
    const res = await get(`${base}${image}`)
    check(res.status === 200 && (res.headers.get('content-type') ?? '').includes('image/png'), `LIVE ${image}: HTTP ${res.status}`)
  }

  if (base === SITE.origin) {
    const appRobots = await text(`${SITE.appOrigin}/robots.txt`, 'LIVE app robots.txt', 'text/plain')
    check(/^Disallow: \/$/m.test(appRobots), 'LIVE app robots.txt must disallow the app')

    const expectRedirect = async (from, to, status = 301) => {
      const res = await get(from)
      check(res.status === status && res.headers.get('location') === to, `LIVE ${from}: expected ${status} → ${to}, got ${res.status} → ${res.headers.get('location')}`)
    }
    await expectRedirect('https://www.hilm.tech/meetings', `${SITE.origin}/meetings`)
    await expectRedirect('http://hilm.tech/features', `${SITE.origin}/features`)
    await expectRedirect(`https://${OLD_DOMAIN}/`, `${SITE.origin}/`)
    await expectRedirect(`https://${OLD_DOMAIN}/ar/meetings`, `${SITE.origin}/ar/meetings`)
    await expectRedirect(`https://${OLD_DOMAIN}/personal/tasks?x=1`, `${SITE.appOrigin}/personal/tasks?x=1`)
    await expectRedirect(`${SITE.appOrigin}/features`, `${SITE.origin}/features`)
    await expectRedirect(`${SITE.origin}/personal/tasks`, `${SITE.appOrigin}/personal/tasks`)
    await expectRedirect(`${SITE.origin}/login`, `${SITE.appOrigin}/login`)

    for (const route of ['/personal/tasks', '/workspace', '/login', '/shared/meeting/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) {
      const res = await get(`${SITE.appOrigin}${route}`)
      check((res.headers.get('x-robots-tag') ?? '').includes('noindex'), `LIVE ${SITE.appOrigin}${route}: missing X-Robots-Tag noindex`)
    }
  }
}

const liveIndex = process.argv.indexOf('--live')
if (liveIndex >= 0) {
  const base = (process.argv[liveIndex + 1] && !process.argv[liveIndex + 1].startsWith('--') ? process.argv[liveIndex + 1] : SITE.origin).replace(/\/$/, '')
  await live(base)
} else {
  offline()
}

if (problems.length) {
  console.error(`seo:check — ${problems.length} problem(s) in ${checks} checks:`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}
console.log(`seo:check — PASS (${checks} checks${liveIndex >= 0 ? ', live' : ''})`)
