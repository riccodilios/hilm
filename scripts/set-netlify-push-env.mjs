/**
 * Upsert Netlify env for Web Push reminders (no custom domain).
 * Uses logged-in Netlify CLI token from %APPDATA%/netlify/Config/config.json
 * or NETLIFY_AUTH_TOKEN.
 *
 * Usage:
 *   $env:NETLIFY_SITE_ID="19ae885a-..."
 *   node scripts/set-netlify-push-env.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1)]
      }),
  )
}

function tokenFromCliConfig() {
  const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'netlify', 'Config', 'config.json')
  if (!fs.existsSync(configPath)) return null
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const user = cfg.users?.[cfg.userId]
  return user?.auth?.token || null
}

const local = { ...loadEnvFile('.env'), ...loadEnvFile('.vapid.local') }
const token = process.env.NETLIFY_AUTH_TOKEN || tokenFromCliConfig()
const siteId = process.env.NETLIFY_SITE_ID || '19ae885a-ff43-41ac-9ee9-596e1ae75dc2'
if (!token) {
  console.error('No Netlify auth token. Run `npx netlify login` or set NETLIFY_AUTH_TOKEN.')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}

const siteRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, { headers })
if (!siteRes.ok) {
  console.error('site lookup failed', await siteRes.text())
  process.exit(1)
}
const site = await siteRes.json()
const accountId = site.account_id

const existingRes = await fetch(
  `https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${siteId}`,
  { headers },
)
const existing = existingRes.ok ? await existingRes.json() : []
const existingKeys = new Set(existing.map((e) => e.key))

const vars = {
  APP_URL: local.APP_URL || local.VITE_APP_URL || 'https://hillm.netlify.app',
  VITE_APP_URL: local.VITE_APP_URL || 'https://hillm.netlify.app',
  VITE_VAPID_PUBLIC_KEY: local.VITE_VAPID_PUBLIC_KEY || local.VAPID_PUBLIC_KEY,
  VAPID_PUBLIC_KEY: local.VAPID_PUBLIC_KEY || local.VITE_VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: local.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: local.VAPID_SUBJECT || 'mailto:noreply@hillm.netlify.app',
  DATABASE_URL: local.DATABASE_POOLER_URL || local.DATABASE_URL,
  CRON_SECRET: local.CRON_SECRET,
  VITE_SUPABASE_URL: local.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: local.VITE_SUPABASE_ANON_KEY,
  OPENROUTER_API_KEY: local.OPENROUTER_API_KEY,
  OPENROUTER_DEFAULT_MODEL: local.OPENROUTER_DEFAULT_MODEL || 'google/gemini-2.5-flash',
}

for (const [key, value] of Object.entries(vars)) {
  if (!value) {
    console.warn(`skip ${key} (empty)`)
    continue
  }
  const isSecret =
    key === 'VAPID_PRIVATE_KEY' ||
    key === 'DATABASE_URL' ||
    key === 'CRON_SECRET' ||
    key === 'VITE_SUPABASE_ANON_KEY' ||
    key === 'OPENROUTER_API_KEY'
  const contexts = isSecret
    ? ['production', 'deploy-preview', 'branch-deploy', 'dev']
    : ['all']
  const body = {
    key,
    is_secret: isSecret,
    // Secrets cannot include post_processing scope
    scopes: isSecret
      ? ['builds', 'functions', 'runtime']
      : ['builds', 'functions', 'runtime', 'post_processing'],
    values: contexts.map((context) => ({ value, context })),
  }

  const url = `https://api.netlify.com/api/v1/accounts/${accountId}/env/${encodeURIComponent(key)}?site_id=${siteId}`
  let res
  if (existingKeys.has(key)) {
    res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) })
  } else {
    res = await fetch(
      `https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${siteId}`,
      { method: 'POST', headers, body: JSON.stringify([body]) },
    )
  }

  if (!res.ok) {
    console.error(key, res.status, await res.text())
    continue
  }
  console.log(existingKeys.has(key) ? 'updated' : 'created', key)
}

console.log('Done. Trigger a Netlify redeploy.')
