import fs from 'node:fs'
import { Client } from 'pg'

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
const jobs = await client.query(
  `select jobid, jobname, schedule, command from cron.job where jobname like 'hilm%'`,
)
console.log(jobs.rows)
await client.end()
