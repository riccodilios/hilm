import fs from 'node:fs'
import { Client } from 'pg'
import { addDays } from 'date-fns'
import { computeProjectHealth, toPersistedHealthStatus } from '../src/shared/project-health/health.ts'

function loadEnv() {
  return Object.fromEntries(
    fs
      .readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1)]
      }),
  )
}

function taskDueDateKey(task) {
  if (task.due_date) {
    const raw = task.due_date
    if (raw instanceof Date) {
      return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`
    }
    return String(raw).slice(0, 10)
  }
  if (task.due_at) {
    const d = new Date(task.due_at)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return null
}

async function refreshProject(client, workspaceId, projectId) {
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const weekAgo = addDays(now, -7).toISOString()
  const twoWeeksAgo = addDays(now, -14).toISOString()

  const { rows: tasks } = await client.query(
    `select status, due_date, due_at, completed_at, updated_at, created_at
     from workspace_tasks
     where workspace_id = $1 and project_id = $2 and status <> 'archived'`,
    [workspaceId, projectId],
  )
  const { rows: activity } = await client.query(
    `select created_at from workspace_activity_events
     where workspace_id = $1 and entity_type = 'project' and entity_id = $2
     order by created_at desc limit 1`,
    [workspaceId, projectId],
  )

  const open = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')
  const total = tasks.length
  const pct = total === 0 ? 0 : Math.round((done.length / total) * 1000) / 10
  const overdueCount = open.filter((t) => {
    const key = taskDueDateKey(t)
    return Boolean(key && key < todayKey)
  }).length
  const lastFromTasks = tasks.reduce((latest, task) => {
    const stamp = task.updated_at || task.completed_at || task.created_at
    if (!stamp) return latest
    if (!latest || stamp > latest) return stamp
    return latest
  }, null)
  const computed = computeProjectHealth({
    completionPct: pct,
    totalTasks: total,
    doneTasks: done.length,
    openTasks: open.length,
    overdueCount,
    waitingCount: open.filter((t) => t.status === 'waiting').length,
    inProgressCount: open.filter((t) => t.status === 'in_progress').length,
    notesCount: 0,
    roadmapTotal: 0,
    roadmapDone: 0,
    lastActivityAt: activity[0]?.created_at ?? lastFromTasks,
    recentCompletions7d: done.filter((t) => t.completed_at && t.completed_at >= weekAgo).length,
    priorCompletions7d: done.filter(
      (t) => t.completed_at && t.completed_at >= twoWeeksAgo && t.completed_at < weekAgo,
    ).length,
  })

  await client.query(
    `update workspace_projects
     set completion_pct = $1, health = $2, health_explanation = $3
     where workspace_id = $4 and id = $5`,
    [pct, toPersistedHealthStatus(computed.health), computed.explanation, workspaceId, projectId],
  )
  return { pct, health: computed.health }
}

async function main() {
  const env = loadEnv()
  const client = new Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const { rows: cols } = await client.query(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and ((table_name = 'workspace_members' and column_name = 'page_permissions')
           or (table_name = 'workspace_projects' and column_name = 'health_explanation'))
       order by 1`,
    )
    const { rows: realtime } = await client.query(
      `select tablename from pg_publication_tables
       where pubname = 'supabase_realtime' and tablename like 'workspace_%'
       order by 1`,
    )
    console.log('migration_verify:', cols.map((r) => r.column_name).join(', '))
    console.log('realtime:', realtime.map((r) => r.tablename).join(', '))

    const { rows: projects } = await client.query(
      'select workspace_id, id, name from workspace_projects order by updated_at desc',
    )
    let refreshed = 0
    for (const project of projects) {
      const result = await refreshProject(client, project.workspace_id, project.id)
      console.log(`refreshed ${project.name}: ${result.pct}% ${result.health}`)
      refreshed++
    }
    console.log(`backfill_ok: ${refreshed} workspace project(s)`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
