const fs = require('fs')
const { Client } = require('pg')

function loadEnv(path) {
  const out = {}
  if (!fs.existsSync(path)) return out
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    let val = line.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

async function main() {
  const env = { ...loadEnv('.env'), ...loadEnv('.env.local') }
  const connectionString = env.DATABASE_URL || env.DATABASE_POOLER_URL
  if (!connectionString) {
    console.error('No DATABASE_URL / DATABASE_POOLER_URL')
    process.exit(1)
  }
  const sql = fs.readFileSync('supabase/migrations/0023_report_engine.sql', 'utf8')
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query(sql)
    const check = await client.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('ai_reports', 'workspace_ai_reports')
        and column_name in ('snapshot', 'config', 'period_start', 'generated_by_name', 'status')
      order by table_name, column_name
    `)
    console.log(
      'migration_ok',
      check.rows.map((r) => `${r.table_name}.${r.column_name}`).join(','),
    )
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
