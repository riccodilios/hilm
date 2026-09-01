#!/usr/bin/env node
/**
 * Post-deploy smoke checks for https://hillm.netlify.app
 * Usage: node scripts/smoke-production.mjs [baseUrl]
 */
const BASE = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'https://hillm.netlify.app').replace(/\/$/, '')

const ROUTES = [
  '/',
  '/login',
  '/signup',
  '/privacy',
  '/auth/callback',
  '/sitemap.xml',
  '/manifest.webmanifest',
]

const REQUIRED_INDEX_PATTERNS = [
  /\/assets\/index-[A-Za-z0-9_-]+\.js/,
  /\/assets\/index-[A-Za-z0-9_-]+\.css/,
]

/** Lazy chunks for OS isolation critical paths (matched inside main bundle). */
const REQUIRED_CHUNK_NAMES = ['AiPage', 'WorkspaceAiPage', 'reports-api', 'personal-api', 'AiChatShell']

function findChunkPath(bundle, baseName) {
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = bundle.match(new RegExp(`assets/${escaped}-[A-Za-z0-9_-]+\\.js`))
  return match ? `/${match[0]}` : null
}

async function check(path) {
  const url = `${BASE}${path}`
  const res = await fetch(url, { redirect: 'follow' })
  return { path, url, status: res.status, ok: res.ok }
}

async function main() {
  console.log(`smoke:production — ${BASE}\n`)
  let failed = 0

  const indexRes = await fetch(`${BASE}/index.html`)
  if (!indexRes.ok) {
    console.error(`FAIL index.html — HTTP ${indexRes.status}`)
    process.exit(1)
  }
  const html = await indexRes.text()

  for (const pattern of REQUIRED_INDEX_PATTERNS) {
    if (!pattern.test(html)) {
      console.error(`FAIL index.html missing asset pattern: ${pattern}`)
      failed++
    }
  }

  const assetMatch = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
  if (!assetMatch) {
    console.error('FAIL index.html missing main JS bundle')
    failed++
  } else {
    const assetUrl = `${BASE}${assetMatch[0]}`
    const assetRes = await fetch(assetUrl)
    if (!assetRes.ok) {
      console.error(`FAIL main bundle ${assetUrl} — HTTP ${assetRes.status}`)
      failed++
    } else {
      console.log(`OK   main bundle ${assetMatch[0]}`)
      const bundle = await assetRes.text()
      for (const name of REQUIRED_CHUNK_NAMES) {
        const chunkPath = findChunkPath(bundle, name)
        if (!chunkPath) {
          console.error(`FAIL main bundle missing lazy chunk ref: ${name}`)
          failed++
          continue
        }
        const chunkUrl = `${BASE}${chunkPath}`
        const chunkRes = await fetch(chunkUrl)
        if (!chunkRes.ok) {
          console.error(`FAIL ${chunkPath} — HTTP ${chunkRes.status}`)
          failed++
        } else {
          console.log(`OK   lazy chunk ${chunkPath}`)
        }
      }
    }
  }

  for (const route of ROUTES) {
    const result = await check(route)
    if (!result.ok) {
      console.error(`FAIL ${route} — HTTP ${result.status}`)
      failed++
    } else {
      console.log(`OK   ${route} — ${result.status}`)
    }
  }

  const swRes = await fetch(`${BASE}/sw.js`)
  if (!swRes.ok) {
    console.error(`FAIL /sw.js — HTTP ${swRes.status}`)
    failed++
  } else {
    console.log(`OK   /sw.js — ${swRes.status}`)
  }

  if (failed > 0) {
    console.log(`\nsmoke:production — FAIL (${failed} check(s))`)
    process.exit(1)
  }
  console.log('\nsmoke:production — PASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
