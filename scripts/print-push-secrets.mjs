/**
 * Print the supabase secrets set command using .vapid.local (gitignored).
 * Usage: node scripts/print-push-secrets.mjs
 */
import fs from 'node:fs'

const path = '.vapid.local'
if (!fs.existsSync(path)) {
  console.error('Missing .vapid.local — run: npx web-push generate-vapid-keys')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const lines = [
  `APP_URL=${env.APP_URL || 'https://hillm.netlify.app'}`,
  `VAPID_PUBLIC_KEY=${env.VAPID_PUBLIC_KEY}`,
  `VAPID_PRIVATE_KEY=${env.VAPID_PRIVATE_KEY}`,
  `VAPID_SUBJECT=${env.VAPID_SUBJECT || 'mailto:noreply@hillm.netlify.app'}`,
  `CRON_SECRET=${env.CRON_SECRET || 'change-me'}`,
]

console.log('Run after: supabase login\n')
console.log(`supabase secrets set ${lines.map((l) => l.replace(/"/g, '\\"')).join(' ')}`)
console.log('\nThen:')
console.log('supabase functions deploy send-task-reminders --project-ref lrvmlayzmvswfqsqroni')
console.log('\nNetlify env:')
console.log(`VITE_VAPID_PUBLIC_KEY=${env.VAPID_PUBLIC_KEY}`)
console.log('VITE_APP_URL=https://hillm.netlify.app')
