/**
 * Production auth audit helper — prints Supabase Auth URL + SMTP status.
 * Does NOT print secrets. Requires SUPABASE_ACCESS_TOKEN + project ref for live checks.
 *
 * Usage: node scripts/audit-auth-config.mjs
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
const prodUrl = (env.VITE_APP_URL || env.NEXT_PUBLIC_APP_URL || 'https://hillm.netlify.app').replace(/\/$/, '')
const supabaseUrl = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ''
const ref =
  env.SUPABASE_PROJECT_REF || supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || ''
const token = env.SUPABASE_ACCESS_TOKEN || ''

console.log('=== Hilm Auth Production Audit ===\n')

console.log('Frontend env (build-time):')
console.log('  VITE_APP_URL:', prodUrl)
console.log('  VITE_SUPABASE_URL:', supabaseUrl ? `${supabaseUrl.slice(0, 32)}…` : '(missing)')
console.log(
  '  VITE_SUPABASE_ANON_KEY:',
  env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '(set)' : '(missing)',
)

if (/localhost|127\.0\.0\.1/i.test(prodUrl)) {
  console.warn('\n⚠ VITE_APP_URL points at localhost — Netlify production builds must use https://hillm.netlify.app')
}

console.log('\nResend (task reminders only — NOT auth signup emails):')
console.log('  RESEND_API_KEY:', env.RESEND_API_KEY ? '(set)' : '(not set — reminders email disabled)')
console.log('  RESEND_FROM_EMAIL:', env.RESEND_FROM_EMAIL || '(default onboarding@resend.dev if set in Supabase secrets)')

if (!token || !ref) {
  console.log('\nSupabase Management API: skipped (set SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF)')
  console.log('\nManual Dashboard checks (Authentication):')
  console.log('  1. URL Configuration → Site URL = https://hillm.netlify.app (NOT localhost:3000)')
  console.log('  2. Redirect URLs include /auth/callback** and /auth/confirm** for prod + localhost:5173 dev')
  console.log('  3. Providers → Email → Confirm email = ON (if verification required)')
  console.log('  4. SMTP Settings → configure custom SMTP for production deliverability')
  console.log('     Default Supabase mailer is rate-limited and unreliable for real users.')
  console.log('  5. Email Templates → Confirm signup uses {{ .ConfirmationURL }} (not hardcoded localhost)')
  process.exit(0)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
})

if (!res.ok) {
  console.error('\nFailed to fetch Supabase auth config:', res.status, await res.text())
  process.exit(1)
}

const auth = await res.json()
const siteUrl = auth.site_url || auth.SITE_URL || ''
const allowList = auth.uri_allow_list || auth.URI_ALLOW_LIST || ''
const smtpHost = auth.smtp_host || auth.SMTP_HOST || ''
const smtpUser = auth.smtp_user || auth.SMTP_USER || ''
const smtpAdmin = auth.smtp_admin_email || auth.SMTP_ADMIN_EMAIL || ''
const mailerAutoconfirm = auth.mailer_autoconfirm ?? auth.MAILER_AUTOCONFIRM

console.log('\nSupabase Auth config (live):')
console.log('  Site URL:', siteUrl || '(empty)')
console.log('  Redirect allow list:', allowList ? '(set)' : '(empty)')
console.log('  Confirm email required:', mailerAutoconfirm === false || mailerAutoconfirm === 'false' ? 'yes' : 'NO — autoconfirm on')
console.log('  SMTP host:', smtpHost || '(empty — using Supabase default mailer)')
console.log('  SMTP user:', smtpUser ? '(set)' : '(empty)')
console.log('  SMTP admin/sender:', smtpAdmin || '(default)')

const issues = []
if (!siteUrl || /localhost|127\.0\.0\.1/i.test(siteUrl)) {
  issues.push('Site URL is missing or points to localhost — confirmation links may break.')
}
if (!String(allowList).includes('hillm.netlify.app')) {
  issues.push('Redirect allow list may not include production /auth/callback URLs.')
}
if (!smtpHost) {
  issues.push('No custom SMTP — auth emails use Supabase default mailer (often blocked / rate-limited).')
}
if (mailerAutoconfirm === true || mailerAutoconfirm === 'true') {
  issues.push('Email autoconfirm is ON — users skip verification emails entirely.')
}

if (issues.length) {
  console.log('\nIssues found:')
  for (const issue of issues) console.log('  •', issue)
} else {
  console.log('\nNo obvious Supabase auth misconfiguration detected via API.')
}

console.log('\nRun `node scripts/configure-auth-urls.mjs` to PATCH Site URL + redirect list when token is set.')
