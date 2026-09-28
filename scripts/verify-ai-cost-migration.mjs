/**
 * Verify migration 0028 AI cost-control columns/functions exist.
 * Usage: node scripts/verify-ai-cost-migration.mjs
 * Requires DATABASE_URL in .env
 */
import fs from 'node:fs'
import { Client } from 'pg'

const envPath = '.env'
if (!fs.existsSync(envPath)) {
  console.error('Missing .env with DATABASE_URL')
  process.exit(1)
}
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
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

const requiredColumns = [
  ['public', 'meetings', 'analysis_input_hash'],
  ['public', 'workspace_meetings', 'analysis_input_hash'],
  ['public', 'meeting_audio_segments', 'content_hash'],
  ['public', 'workspace_meeting_audio_segments', 'content_hash'],
]

await client.connect()
try {
  let ok = true
  for (const [schema, table, column] of requiredColumns) {
    const { rows } = await client.query(
      `select 1 from information_schema.columns
       where table_schema = $1 and table_name = $2 and column_name = $3`,
      [schema, table, column],
    )
    const present = rows.length > 0
    console.log(`${present ? 'OK' : 'MISSING'} ${table}.${column}`)
    if (!present) ok = false
  }

  const { rows: tables } = await client.query(
    `select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'ai_runtime_controls'`,
  )
  console.log(`${tables.length ? 'OK' : 'MISSING'} ai_runtime_controls`)
  if (!tables.length) ok = false

  const { rows: fns } = await client.query(
    `select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_ai_runtime_controls'`,
  )
  console.log(`${fns.length ? 'OK' : 'MISSING'} get_ai_runtime_controls()`)
  if (!fns.length) ok = false

  const { rows: summary } = await client.query(
    `select pg_get_functiondef(p.oid) as def
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_ai_usage_summary'
     limit 1`,
  )
  const hasByFeature = (summary[0]?.def || '').includes('by_feature')
  console.log(`${hasByFeature ? 'OK' : 'MISSING'} get_ai_usage_summary by_feature`)
  if (!hasByFeature) ok = false

  if (!ok) {
    console.error('Migration 0028 verification FAILED')
    process.exitCode = 1
  } else {
    console.log('Migration 0028 verification PASSED')
  }
} finally {
  await client.end()
}
