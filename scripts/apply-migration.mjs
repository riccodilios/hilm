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

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <path.sql>')
  process.exit(1)
}

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
try {
  await client.query(fs.readFileSync(file, 'utf8'))
  console.log(`Applied ${file}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end()
}
