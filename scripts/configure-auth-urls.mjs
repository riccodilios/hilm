/**
 * Prints the exact Supabase Auth URL config you must set in the Dashboard.
 * Optionally PATCHes auth config when SUPABASE_ACCESS_TOKEN + project ref are present.
 *
 * Usage: node scripts/configure-auth-urls.mjs
 */
import fs from 'fs'

function loadEnv() {
  const env = {}
  for (const file of ['.env', '.env.local']) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const i = line.indexOf('=')
      if (i < 0) continue
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return env
}

const env = loadEnv()
const prod = (env.VITE_APP_URL || env.NEXT_PUBLIC_APP_URL || 'https://hillm.netlify.app').replace(/\/$/, '')
const isLocal = /localhost|127\.0\.0\.1/i.test(prod)
const siteUrl = isLocal ? 'https://hillm.netlify.app' : prod

const redirectUrls = [
  `${siteUrl}/auth/callback`,
  `${siteUrl}/auth/callback/**`,
  `${siteUrl}/auth/confirm`,
  `${siteUrl}/auth/confirm/**`,
  'http://localhost:5173/auth/callback',
  'http://localhost:5173/auth/callback/**',
  'http://localhost:5173/auth/confirm',
  'http://localhost:5173/auth/confirm/**',
]

console.log('=== Required Supabase Auth URL Configuration ===')
console.log('Site URL:', siteUrl)
console.log('Redirect URLs:')
for (const url of redirectUrls) console.log(' -', url)
console.log('\nNetlify must set VITE_APP_URL=' + siteUrl)

const token = env.SUPABASE_ACCESS_TOKEN
const ref =
  env.SUPABASE_PROJECT_REF ||
  (env.VITE_SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]

if (!token || !ref) {
  console.log('\nNo SUPABASE_ACCESS_TOKEN — open Dashboard → Authentication → URL Configuration and paste the values above.')
  process.exit(0)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    site_url: siteUrl,
    uri_allow_list: redirectUrls.join(','),
  }),
})

if (!res.ok) {
  console.error('Failed to update Supabase auth config:', res.status, await res.text())
  process.exit(1)
}

console.log('\nUpdated Supabase Auth Site URL + redirect allow list for project', ref)
