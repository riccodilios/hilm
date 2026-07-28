import fs from 'node:fs'
import { Client } from 'pg'

function load(path) {
  if (!fs.existsSync(path)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1)]
      }),
  )
}

const env = { ...load('.env'), ...load('.vapid.local') }
const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
const rows = [
  ['VAPID_PUBLIC_KEY', env.VAPID_PUBLIC_KEY],
  ['VAPID_PRIVATE_KEY', env.VAPID_PRIVATE_KEY],
  ['VAPID_SUBJECT', env.VAPID_SUBJECT || 'mailto:noreply@hillm.netlify.app'],
  ['APP_URL', env.APP_URL || 'https://hillm.netlify.app'],
  ['CRON_SECRET', env.CRON_SECRET || 'hilm-cron-change-me-in-prod'],
]

for (const [key, value] of rows) {
  if (!value) {
    console.warn('missing', key)
    continue
  }
  await client.query(
    `insert into private.server_secrets(key, value)
     values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value],
  )
  console.log('seeded', key)
}

await client.end()
