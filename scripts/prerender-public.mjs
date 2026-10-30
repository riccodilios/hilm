#!/usr/bin/env node
/**
 * Build step (after `vite build`): prerenders the public marketing pages so crawlers that do not
 * run JavaScript (most AI crawlers) get the real content and metadata in the first HTML response.
 *
 * Writes, from src/content (the same source the React pages use):
 *   dist/_public/{en,ar}/{page}.html   page HTML, served at the public URLs via dist/_redirects
 *   dist/_redirects                    public-page rewrites and per-host rules (applied before netlify.toml)
 *   dist/sitemap.xml                   public pages only, with hreflang alternates
 *   dist/llms.txt, dist/llms-full.txt  AI-readable product guide
 *   dist/<INDEXNOW_KEY>.txt            IndexNow ownership file (only when INDEXNOW_KEY is set)
 *
 * Optional build env (public, non-secret): GOOGLE_SITE_VERIFICATION, BING_SITE_VERIFICATION.
 * Run with: node --experimental-strip-types scripts/prerender-public.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOME_CONTENT,
  PAGE_META,
  PAGE_UPDATED,
  PRODUCT_PAGES,
  PRODUCT_PAGE_IDS,
  PUBLIC_LOCALES,
  PUBLIC_PAGE_IDS,
  PUBLIC_UI,
  SITE,
  publicPath,
  publicUrl,
} from '../src/content/site.ts'
import { pageJsonLd } from '../src/content/structured-data.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const LOCALE_TEXT = {
  en: JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/locales/en.json'), 'utf8')),
  ar: JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/locales/ar.json'), 'utf8')),
}
const BRAND = { en: 'Hilm', ar: 'حلم' }
const OG_LOCALE = { en: 'en_US', ar: 'ar_SA' }

const esc = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── Head ────────────────────────────────────────────────────────────────────

function verificationTags() {
  const tags = []
  for (const [env, name] of [
    ['GOOGLE_SITE_VERIFICATION', 'google-site-verification'],
    ['BING_SITE_VERIFICATION', 'msvalidate.01'],
  ]) {
    for (const token of (process.env[env] ?? '').split(',').map((item) => item.trim()).filter(Boolean)) {
      if (/^[A-Za-z0-9_-]{8,128}$/.test(token)) tags.push(`<meta name="${name}" content="${esc(token)}" />`)
    }
  }
  return tags
}

function seoHead(id, locale) {
  const meta = PAGE_META[id][locale]
  const url = publicUrl(id, locale)
  const image = `${SITE.origin}${SITE.ogImage[locale]}`
  const jsonLd = JSON.stringify(pageJsonLd(id, locale)).replace(/</g, '\\u003c')
  return [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />',
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" hreflang="en" href="${publicUrl(id, 'en')}" />`,
    `<link rel="alternate" hreflang="ar" href="${publicUrl(id, 'ar')}" />`,
    `<link rel="alternate" hreflang="x-default" href="${publicUrl(id, 'en')}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${SITE.name}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="${SITE.ogImage.width}" />`,
    `<meta property="og:image:height" content="${SITE.ogImage.height}" />`,
    `<meta property="og:image:alt" content="${esc(meta.title)}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[locale]}" />`,
    `<meta property="og:locale:alternate" content="${OG_LOCALE[locale === 'en' ? 'ar' : 'en']}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<link rel="alternate" type="text/plain" href="${SITE.origin}/llms.txt" title="llms.txt" />`,
    ...verificationTags(),
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n    ')
}

// ── Body (semantic HTML mirroring the React page) ───────────────────────────

const link = (href, text, attrs = '') => `<a href="${href}"${attrs}>${esc(text)}</a>`
const pageLink = (id, locale, text) => link(publicUrl(id, locale), text)
const appLink = (pathname, text) => link(`${SITE.appOrigin}${pathname}`, text)

function header(id, locale) {
  const ui = PUBLIC_UI[locale]
  const other = locale === 'en' ? 'ar' : 'en'
  return `<header>
  <p>${pageLink('home', locale, BRAND[locale])}</p>
  <nav aria-label="${esc(ui.primaryNav)}"><ul>${PRODUCT_PAGE_IDS.map(
    (page) => `<li>${link(publicUrl(page, locale), ui.nav[page], page === id ? ' aria-current="page"' : '')}</li>`,
  ).join('')}</ul></nav>
  <p>${link(publicUrl(id, other), ui.otherLanguage, ` hreflang="${other}" lang="${other}"`)} · ${appLink('/login', ui.signIn)} · ${appLink('/signup', ui.getStarted)}</p>
</header>`
}

function footer(locale) {
  const ui = PUBLIC_UI[locale]
  return `<footer>
  <p>${esc(BRAND[locale])} — ${esc(ui.footerTagline)}</p>
  <ul>${PRODUCT_PAGE_IDS.map((page) => `<li>${pageLink(page, locale, ui.nav[page])}</li>`).join('')}<li>${pageLink('privacy', locale, ui.privacy)}</li><li>${link(`mailto:${SITE.contactEmail}`, ui.contact)}</li></ul>
</footer>`
}

const list = (items) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
const featureList = (items) =>
  `<ul>${items.map((item) => `<li><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></li>`).join('')}</ul>`
const faqBlock = (title, items) =>
  `<section id="faq"><h2>${esc(title)}</h2>${items
    .map((item) => `<article><h3>${esc(item.q)}</h3><p>${esc(item.a)}</p></article>`)
    .join('')}</section>`

function homeBody(locale) {
  const l = LOCALE_TEXT[locale].landing
  const ui = PUBLIC_UI[locale]
  const home = HOME_CONTENT[locale]
  const features = Object.values(l.features)
  const workspace = Object.values(l.workspaceFeatures)
  return `<main>
<section><h1>${esc(BRAND[locale])} — ${esc(home.h1Suffix)}</h1><p>${esc(l.heroSubtitle)}</p><p>${esc(l.heroDescription)}</p><p>${appLink('/signup', ui.getStarted)}</p></section>
<section><h2>${esc(l.systemsTitle)}</h2><p>${esc(l.systemsDescription)}</p>
<h3>${esc(l.systems.personalTitle)}</h3><p>${esc(l.systems.personalBody)}</p>${list(l.systems.personalPoints)}<p>${pageLink('personal-os', locale, `${ui.learnMore}: ${ui.nav['personal-os']}`)}</p>
<h3>${esc(l.systems.workspaceTitle)}</h3><p>${esc(l.systems.workspaceBody)}</p>${list(l.systems.workspacePoints)}<p>${pageLink('workspace-os', locale, `${ui.learnMore}: ${ui.nav['workspace-os']}`)}</p></section>
<section><h2>${esc(l.problemTitle)}</h2><p>${esc(l.problemDescription)}</p><p>${esc(l.thenHilmBody)}</p></section>
<section><h2>${esc(l.featuresTitle)}</h2><p>${esc(l.featuresDescription)}</p>${featureList(features)}<p>${pageLink('features', locale, `${ui.learnMore}: ${ui.nav.features}`)}</p></section>
<section><h2>${esc(l.workspaceTitle)}</h2><p>${esc(l.workspaceDescription)}</p>${featureList(workspace)}</section>
<section><h2>${esc(home.meetings.title)}</h2><p>${esc(home.meetings.body)}</p>${list(home.meetings.points)}<p>${pageLink('meetings', locale, home.meetings.link)}</p></section>
<section><h2>${esc(l.automationTitle)}</h2><p>${esc(l.automationDescription)}</p>${list(l.automationActions)}</section>
<section><h2>${esc(l.securityTitle)}</h2><p>${esc(l.securityDescription)}</p>${featureList(Object.values(l.security))}</section>
${faqBlock(l.faqTitle, home.faq)}
<section><h2>${esc(l.ctaTitle)}</h2><p>${esc(l.ctaBody)}</p><p>${appLink('/signup', ui.getStarted)}</p></section>
</main>`
}

function productBody(id, locale) {
  const page = PRODUCT_PAGES[id][locale]
  const ui = PUBLIC_UI[locale]
  const sections = page.sections
    .map(
      (section) =>
        `<section id="${section.id}"><h2>${esc(section.h2)}</h2><p>${esc(section.body)}</p>${
          section.items?.length ? featureList(section.items) : ''
        }${section.link ? `<p>${pageLink(section.link, locale, `${ui.learnMore}: ${ui.nav[section.link]}`)}</p>` : ''}</section>`,
    )
    .join('\n')
  return `<main>
<nav aria-label="${esc(ui.breadcrumbLabel)}"><ol><li>${pageLink('home', locale, ui.home)}</li><li aria-current="page">${esc(page.eyebrow)}</li></ol></nav>
<section><p>${esc(page.eyebrow)}</p><h1>${esc(page.h1)}</h1>${page.intro.map((p) => `<p>${esc(p)}</p>`).join('')}<p>${appLink('/signup', ui.getStarted)} · ${appLink('/login', ui.signIn)}</p></section>
${sections}
${page.faq?.length ? faqBlock(ui.faqTitle, page.faq) : ''}
<section><h2>${esc(ui.relatedTitle)}</h2><ul>${page.related
    .map((related) => `<li>${pageLink(related, locale, ui.nav[related])} — ${esc(PAGE_META[related][locale].description)}</li>`)
    .join('')}</ul></section>
<section><h2>${esc(page.cta.title)}</h2><p>${esc(page.cta.body)}</p><p>${appLink('/signup', ui.getStarted)}</p></section>
</main>`
}

function privacyBody(locale) {
  const p = LOCALE_TEXT[locale].privacy
  return `<main><h1>${esc(p.title)}</h1><p>${esc(p.description)}</p><p>${esc(p.p1)}</p><p>${esc(p.p2)}</p><p>${esc(
    p.p3.replace('{{email}}', SITE.contactEmail),
  )}</p></main>`
}

function body(id, locale) {
  const main = id === 'home' ? homeBody(locale) : id === 'privacy' ? privacyBody(locale) : productBody(id, locale)
  return `${header(id, locale)}\n${main}\n${footer(locale)}`
}

// ── Page assembly ───────────────────────────────────────────────────────────

function renderPage(template, id, locale) {
  const start = template.indexOf('<!-- seo:start')
  const endMarker = '<!-- seo:end -->'
  const end = template.indexOf(endMarker)
  if (start < 0 || end < 0) throw new Error('index.html is missing the <!-- seo:start --> / <!-- seo:end --> markers')
  let html = `${template.slice(0, start)}${seoHead(id, locale)}${template.slice(end + endMarker.length)}`
  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  if (!html.includes('<html lang="en">')) throw new Error('index.html must start with <html lang="en">')
  html = html.replace('<html lang="en">', `<html lang="${locale}" dir="${dir}" data-public-locale="${locale}">`)
  if (!html.includes('<div id="root"></div>')) throw new Error('index.html is missing <div id="root"></div>')
  html = html.replace('<div id="root"></div>', `<div id="root"><div class="hilm-prerender">\n${body(id, locale)}\n</div></div>`)
  return html.replace(/<noscript>[\s\S]*?<\/noscript>\s*/, '')
}

function sitemap() {
  const urls = PUBLIC_PAGE_IDS.flatMap((id) =>
    PUBLIC_LOCALES.map(
      (locale) => `  <url>
    <loc>${publicUrl(id, locale)}</loc>
    <lastmod>${PAGE_UPDATED[id]}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="${publicUrl(id, 'en')}" />
    <xhtml:link rel="alternate" hreflang="ar" href="${publicUrl(id, 'ar')}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${publicUrl(id, 'en')}" />
  </url>`,
    ),
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`
}

function llms() {
  const ui = PUBLIC_UI.en
  const product = PRODUCT_PAGE_IDS.map((id) => `- [${ui.nav[id]}](${publicUrl(id, 'en')}): ${PAGE_META[id].en.description}`)
  const arabic = PUBLIC_PAGE_IDS.filter((id) => id !== 'privacy').map(
    (id) => `- [${PAGE_META[id].ar.title}](${publicUrl(id, 'ar')})`,
  )
  return `# Hilm

> Hilm is a Personal and Workspace Operating System: one web app where individuals organize their projects, tasks, meetings and notes (Personal OS) and teams run shared projects together (Workspace OS), with an AI assistant that acts on that data after the user confirms.

- Official website: ${SITE.origin}/
- Web app (sign in / sign up): ${SITE.appOrigin}/
- Also written: ${SITE.alternateNames.join(', ')}
- Category: personal and team productivity; project and task management; AI meeting notes
- Languages: English and Arabic (right-to-left)
- Platforms: web browser; installable Progressive Web App on desktop and mobile

Hilm is not a standalone chatbot or a single-purpose note-taking app. Personal OS is private to one account; Workspace OS is shared with workspace members. Both live under one Hilm account.

## Product

${product.join('\n')}

## Frequently asked questions

${HOME_CONTENT.en.faq.map((item) => `### ${item.q}\n\n${item.a}`).join('\n\n')}

## Arabic pages (العربية)

${arabic.join('\n')}

## Policies

- [Privacy](${publicUrl('privacy', 'en')})

## Optional

- [Full product description](${SITE.origin}/llms-full.txt)
- [Sitemap](${SITE.origin}/sitemap.xml)
`
}

function llmsFull() {
  const pages = PRODUCT_PAGE_IDS.map((id) => {
    const page = PRODUCT_PAGES[id].en
    const sections = page.sections
      .map(
        (section) =>
          `### ${section.h2}\n\n${section.body}${
            section.items?.length ? `\n\n${section.items.map((item) => `- **${item.title}:** ${item.body}`).join('\n')}` : ''
          }`,
      )
      .join('\n\n')
    const faq = page.faq?.length ? `\n\n### Questions\n\n${page.faq.map((item) => `**${item.q}**\n${item.a}`).join('\n\n')}` : ''
    return `## ${page.h1}\n\nSource: ${publicUrl(id, 'en')}\n\n${page.intro.join('\n\n')}\n\n${sections}${faq}`
  })
  return `# Hilm — full product description

> Plain-text version of the public pages on ${SITE.origin}. Hilm is a Personal and Workspace Operating System with an AI assistant; this file describes shipped capabilities only.

${pages.join('\n\n')}

## Frequently asked questions

${HOME_CONTENT.en.faq.map((item) => `**${item.q}**\n${item.a}`).join('\n\n')}
`
}

/**
 * Netlify applies dist/_redirects before netlify.toml. These rules depend on the public page list,
 * so they are generated here; app routes, /api and the SPA fallback stay in netlify.toml.
 */
function redirectsFile() {
  const pages = PUBLIC_LOCALES.flatMap((locale) => PUBLIC_PAGE_IDS.map((id) => ({ id, locale, path: publicPath(id, locale) })))
  const lines = ['# Generated by scripts/prerender-public.mjs — do not edit.']
  // Private console host (from build env only; _redirects itself is never served publicly).
  const adminHost = (process.env.ADMIN_HOST ?? '').trim().toLowerCase()
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(adminHost)) {
    lines.push(
      `https://${adminHost}/robots.txt  /robots-app.txt  200!`,
      `https://${adminHost}/  /admin.html  200!`,
      `https://${adminHost}/*  /admin.html  200`,
    )
  }
  lines.push(
    '# The console page only exists on the console host',
    '/admin.html  /index.html  404!',
    '# robots.txt per host',
    'https://app.hilm.tech/robots.txt  /robots-app.txt  200!',
    'https://hillm.netlify.app/robots.txt  /robots.txt  200!',
    '# Public pages live on hilm.tech only',
  )
  for (const page of pages) {
    if (page.path !== '/') lines.push(`https://app.hilm.tech${page.path}  ${SITE.origin}${page.path}  301!`)
    lines.push(`https://hillm.netlify.app${page.path}  ${SITE.origin}${page.path}  301!`)
  }
  lines.push('# Prerendered public pages')
  lines.push(`${SITE.origin}/  /_public/en/home.html  200!`)
  for (const page of pages) {
    if (page.path !== '/') lines.push(`${page.path}  /_public/${page.locale}/${page.id}.html  200`)
  }
  return `${lines.join('\n')}\n`
}

// ── Main ────────────────────────────────────────────────────────────────────

const templatePath = path.join(DIST, 'index.html')
if (!fs.existsSync(templatePath)) throw new Error('Run `vite build` first: dist/index.html not found')
const template = fs.readFileSync(templatePath, 'utf8')

const written = []
for (const locale of PUBLIC_LOCALES) {
  for (const id of PUBLIC_PAGE_IDS) {
    const file = path.join(DIST, '_public', locale, `${id}.html`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, renderPage(template, id, locale))
    written.push(`${publicPath(id, locale)} -> ${path.relative(DIST, file).replace(/\\/g, '/')}`)
  }
}
fs.writeFileSync(path.join(DIST, '_redirects'), redirectsFile())

// The private console is not an installable app: drop the PWA manifest link the plugin injects.
const adminHtml = path.join(DIST, 'admin.html')
if (fs.existsSync(adminHtml)) {
  fs.writeFileSync(adminHtml, fs.readFileSync(adminHtml, 'utf8').replace(/<link rel="manifest"[^>]*>/g, ''))
}
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap())
fs.writeFileSync(path.join(DIST, 'llms.txt'), llms())
fs.writeFileSync(path.join(DIST, 'llms-full.txt'), llmsFull())

const indexNowKey = (process.env.INDEXNOW_KEY ?? '').trim()
if (indexNowKey) {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(indexNowKey)) throw new Error('INDEXNOW_KEY must be 8-128 letters, digits or dashes')
  fs.writeFileSync(path.join(DIST, `${indexNowKey}.txt`), indexNowKey)
}

console.log(`prerender-public: ${written.length} pages, sitemap.xml, llms.txt, llms-full.txt${indexNowKey ? ', IndexNow key file' : ''}`)
for (const line of written) console.log(`  ${line}`)
