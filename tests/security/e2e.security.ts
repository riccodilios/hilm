/**
 * End-to-end checks against the live stack (Supabase REST, Realtime, Storage, Netlify) with
 * temporary accounts created for this run and removed afterwards. No real customer data is read or
 * changed, and no AI provider is called (the quota test only reserves and releases usage slots).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type pg from 'pg'
import { fetchAllByKeyset } from '../../src/lib/supabase/paginate'
import { acquireDb, resetDbPool } from '../../netlify/functions/_shared/db'
import { claimDueReminders } from '../../netlify/functions/_shared/reminder-claims'
import { createSupabaseStorageProvider } from '../../netlify/functions/_shared/storage/supabase-provider'
import { resetStorageWorkerToken, workerAuthConfig } from '../../netlify/functions/_shared/storage/worker-auth'
import { createAuthUser, DATABASE_URL, env, newClient, testEmail, uid } from './helpers'

const SUPABASE_URL = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const APP = 'https://app.hilm.tech'
const PASSWORD = `Sec-${uid()}`

const u = { owner: uid(), member: uid(), other: uid(), viewer: uid(), doomed: uid() }
const emails: Record<string, string> = {}
const clients: Record<string, SupabaseClient> = {}
const ids: Record<string, string> = {}
let db: pg.Client

async function signIn(label: keyof typeof u) {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email: emails[label]!, password: PASSWORD })
  if (error) throw error
  clients[label] = client
  return client
}

beforeAll(async () => {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing')
  db = newClient()
  await db.connect()
  for (const [label, id] of Object.entries(u)) {
    emails[label] = testEmail(label)
    await createAuthUser(db, id, emails[label]!, PASSWORD)
  }
  for (const label of Object.keys(u) as Array<keyof typeof u>) await signIn(label)

  const { data: ws, error } = await clients.owner!.rpc('create_workspace', { p_name: 'Security E2E', p_description: null, p_color: '#60a5fa' })
  if (error) throw error
  ids.ws = (ws as { id: string }).id
  await db.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'member'), ($1, $4, 'viewer')`,
    [ids.ws, u.member, u.other, u.viewer],
  )
  ids.project = (await db.query(`insert into public.workspace_projects (workspace_id, created_by, name) values ($1, $2, 'E2E') returning id`, [ids.ws, u.owner])).rows[0].id
  const task = async (assignee: string, title: string) =>
    (await db.query(`insert into public.workspace_tasks (workspace_id, project_id, created_by, title, assignee_id) values ($1, $2, $3, $4, $5) returning id`, [ids.ws, ids.project, u.owner, title, assignee])).rows[0].id as string
  ids.memberTask = await task(u.member, 'member task')
  ids.otherTask = await task(u.other, 'other task')
}, 240_000)

afterAll(async () => {
  try {
    // Every object this run created (including rejected uploads nobody can read) is removed through
    // the storage worker account, then its registry rows are closed.
    const prefixes = [`workspace/${ids.ws}/%`, ...Object.values(u).map((id) => `${id}/%`)]
    const leftovers = (await db.query(`select bucket_id, name from storage.objects where name like any($1::text[])`, [prefixes])).rows as Array<{ bucket_id: string; name: string }>
    const config = workerAuthConfig(env)
    if (leftovers.length && config) {
      resetStorageWorkerToken()
      const worker = createSupabaseStorageProvider(config)
      for (const bucket of new Set(leftovers.map((o) => o.bucket_id))) {
        await worker.deleteObjects(bucket, leftovers.filter((o) => o.bucket_id === bucket).map((o) => o.name))
      }
    }
    if (ids.ws) await db.query(`delete from public.workspaces where id = $1`, [ids.ws])
    await db.query(`delete from auth.users where id = any($1::uuid[])`, [Object.values(u)])
    await db.query(
      `update public.storage_files f set status = 'deleted', deleted_at = now()
       where f.status <> 'deleted' and f.object_key like any($1::text[])
         and not exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = f.object_key)`,
      [prefixes],
    )
    await db.query(
      `delete from private.storage_object_deletions d where d.object_name like any($1::text[])
         and not exists (select 1 from storage.objects o where o.bucket_id = d.bucket_id and o.name = d.object_name)`,
      [prefixes],
    )
  } finally {
    for (const client of Object.values(clients)) await client.removeAllChannels().catch(() => undefined)
    await db.end().catch(() => undefined)
    await resetDbPool()
  }
}, 240_000)

describe('Realtime isolation', () => {
  it('members only receive changes for tasks they may see', async () => {
    const received: Record<string, string[]> = { owner: [], member: [] }
    const subscribe = (label: 'owner' | 'member') =>
      new Promise<void>((resolve, reject) => {
        const client = clients[label]!
        void client.realtime.setAuth()
        client
          .channel(`sec-${label}-${uid()}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workspace_tasks', filter: `workspace_id=eq.${ids.ws}` }, (payload) => {
            received[label]!.push(String((payload.new as { id: string }).id))
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') resolve()
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status))
          })
      })
    await Promise.all([subscribe('owner'), subscribe('member')])
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const hidden = (await db.query(`insert into public.workspace_tasks (workspace_id, project_id, created_by, title, assignee_id) values ($1, $2, $3, 'not for member', $4) returning id`, [ids.ws, ids.project, u.owner, u.other])).rows[0].id
    const mine = (await db.query(`insert into public.workspace_tasks (workspace_id, project_id, created_by, title, assignee_id) values ($1, $2, $3, 'for member', $4) returning id`, [ids.ws, ids.project, u.owner, u.member])).rows[0].id
    await new Promise((resolve) => setTimeout(resolve, 8000))

    expect(received.owner).toEqual(expect.arrayContaining([hidden, mine]))
    expect(received.member).toContain(mine)
    expect(received.member).not.toContain(hidden)
  }, 60_000)
})

describe('REST: visibility, pagination, permissions', () => {
  it('a member reads only their own task through the REST API', async () => {
    const { data } = await clients.member!.from('workspace_tasks').select('id').eq('workspace_id', ids.ws)
    const visible = (data ?? []).map((row) => row.id)
    expect(visible).toContain(ids.memberTask)
    expect(visible).not.toContain(ids.otherTask)
  })

  it('lists past the 1,000-row response cap are read completely and without duplicates', async () => {
    await db.query(
      `insert into public.workspace_tasks (workspace_id, project_id, created_by, title, assignee_id)
       select $1, $2, $3, 'bulk ' || g, $3 from generate_series(1, 1050) g`,
      [ids.ws, ids.project, u.owner],
    )
    const { count } = await clients.owner!.from('workspace_tasks').select('id', { count: 'exact', head: true }).eq('workspace_id', ids.ws)
    const capped = await clients.owner!.from('workspace_tasks').select('id').eq('workspace_id', ids.ws)
    expect(capped.data!.length).toBe(1000)
    const all = await fetchAllByKeyset<{ id: string }>((afterId, size) => {
      let q = clients.owner!.from('workspace_tasks').select('id').eq('workspace_id', ids.ws).order('id').limit(size)
      if (afterId) q = q.gt('id', afterId)
      return q
    })
    expect(all.length).toBe(count)
    expect(count).toBeGreaterThan(1000)
    expect(new Set(all.map((row) => row.id)).size).toBe(all.length)
  }, 120_000)

  it('users cannot raise their AI tier or complete usage events', async () => {
    const tier = await clients.member!.from('profiles').update({ ai_tier_id: 'team' } as never).eq('id', u.member)
    expect(tier.error).toBeTruthy()
    const complete = await clients.member!.rpc('complete_ai_request', { p_event_id: uid(), p_status: 'completed' } as never)
    expect(complete.error).toBeTruthy()
    const row = await db.query(`select ai_tier_id from public.profiles where id = $1`, [u.member])
    expect(row.rows[0].ai_tier_id).toBe('free')
  })

  it('concurrent AI requests cannot exceed the plan’s concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        clients.member!.rpc('begin_ai_request', { p_request_kind: 'chat', p_fingerprint: `sec-${i}-${uid()}` } as never),
      ),
    )
    const outcomes = results.map((r) => (r.error ? `error:${r.error.message}` : ((r.data as { ok?: boolean; code?: string }).ok ? 'ok' : (r.data as { code?: string }).code)))
    console.log('begin_ai_request outcomes:', outcomes)
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'concurrent_limit')).toHaveLength(5)
  })

  it('CRM integrations are not readable by members', async () => {
    await clients.owner!.from('workspace_crm_integrations').insert({ workspace_id: ids.ws, provider: 'zoho', status: 'configured', created_by: u.owner } as never)
    const asMember = await clients.member!.from('workspace_crm_integrations').select('*').eq('workspace_id', ids.ws)
    expect(asMember.data ?? []).toHaveLength(0)
    const asOwner = await clients.owner!.from('workspace_crm_integrations').select('id').eq('workspace_id', ids.ws)
    expect(asOwner.data ?? []).toHaveLength(1)
  })
})

const TEST_TEXT = 'hilm security test'

/** The production upload flow through the public API: begin → upload to the issued key → complete. */
async function uploadVia(client: SupabaseClient, entityType: 'task' | 'workspace_task', entityId: string, name: string, body = TEST_TEXT) {
  const blob = new Blob([body], { type: 'text/plain' })
  const begun = await client.rpc('storage_begin_upload', {
    p_category: 'task_attachment',
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_filename: name,
    p_mime: 'text/plain',
    p_size: blob.size,
  } as never)
  if (begun.error) throw begun.error
  const slot = begun.data as { ok: boolean; code?: string; file_id: string; object_key: string }
  if (!slot.ok) return { slot, upload: null, complete: null }
  const upload = await client.storage.from('attachments').upload(slot.object_key, blob, { contentType: 'text/plain' })
  const complete = upload.error ? null : await client.rpc('storage_complete_upload', { p_file_id: slot.file_id } as never)
  return { slot, upload, complete: complete?.data as { ok: boolean; reason?: string } | null }
}

describe('Storage API', () => {
  const file = () => new Blob([TEST_TEXT], { type: 'text/plain' })

  it('uploads only through a server-issued slot; the stored object is verified', async () => {
    const direct = await clients.member!.storage.from('attachments').upload(`workspace/${ids.ws}/tasks/${ids.memberTask}/1_direct.txt`, file())
    expect(direct.error).toBeTruthy()
    const forged = await clients.member!.from('workspace_attachments').insert({ workspace_id: ids.ws, entity_type: 'task', entity_id: ids.memberTask, storage_path: 'x', filename: 'x' } as never)
    expect(forged.error).toBeTruthy()

    const lying = await clients.member!.rpc('storage_begin_upload', {
      p_category: 'task_attachment', p_entity_type: 'workspace_task', p_entity_id: ids.memberTask, p_filename: 'lie.txt', p_mime: 'text/plain', p_size: 3,
    } as never)
    const slot = lying.data as { file_id: string; object_key: string }
    await clients.member!.storage.from('attachments').upload(slot.object_key, file())
    const verdict = await clients.member!.rpc('storage_complete_upload', { p_file_id: slot.file_id } as never)
    expect((verdict.data as { ok: boolean; reason?: string }).reason).toBe('size_mismatch')
    const unreadable = await clients.member!.storage.from('attachments').download(slot.object_key)
    expect(unreadable.error).toBeTruthy()

    const blocked = await uploadVia(clients.member!, 'workspace_task', ids.memberTask, 'evil.html')
    expect(blocked.slot.code).toBe('blocked_type')
  })

  it('enforces task visibility, viewer read-only and uploader-only deletion', async () => {
    const own = await uploadVia(clients.member!, 'workspace_task', ids.memberTask, 'member.txt')
    expect(own.upload?.error).toBeNull()
    expect(own.complete?.ok).toBe(true)
    const memberPath = own.slot.object_key
    const readBack = await clients.member!.storage.from('attachments').download(memberPath)
    expect(await readBack.data?.text()).toBe(TEST_TEXT)

    const hiddenTask = await uploadVia(clients.member!, 'workspace_task', ids.otherTask, 'peek.txt')
    expect(hiddenTask.slot.ok).toBe(false)

    const viewerUpload = await uploadVia(clients.viewer!, 'workspace_task', ids.memberTask, 'viewer.txt')
    expect(viewerUpload.slot.ok).toBe(false)

    const otherRead = await clients.other!.storage.from('attachments').download(memberPath)
    expect(otherRead.error).toBeTruthy()

    const otherDelete = await clients.other!.storage.from('attachments').remove([memberPath])
    expect(otherDelete.data ?? []).toHaveLength(0)
    const viewerDelete = await clients.viewer!.storage.from('attachments').remove([memberPath])
    expect(viewerDelete.data ?? []).toHaveLength(0)

    const overwrite = await clients.other!.storage.from('attachments').upload(memberPath, file(), { upsert: true })
    expect(overwrite.error).toBeTruthy()

    const ownerDelete = await clients.owner!.storage.from('attachments').remove([memberPath])
    expect(ownerDelete.data ?? []).toHaveLength(1)
  })
})

describe('Storage worker (live provider)', () => {
  it('a provider failure is retried; a real deletion through the worker account is confirmed', async () => {
    const config = workerAuthConfig(env)
    expect(config, 'STORAGE_WORKER_EMAIL / STORAGE_WORKER_PASSWORD must be set').toBeTruthy()
    const up = await uploadVia(clients.member!, 'workspace_task', ids.memberTask, 'worker.txt')
    expect(up.complete?.ok).toBe(true)
    const key = up.slot.object_key
    await db.query(`delete from public.workspace_attachments where storage_path = $1`, [key])
    const queued = (await db.query(`select id, status from private.storage_object_deletions where bucket_id = 'attachments' and object_name = $1`, [key])).rows[0]
    expect(queued.status).toBe('pending')
    const recordResult = async (ok: boolean, error: string | null) =>
      (await db.query(`select private.storage_record_deletion($1, null, $2, $3) as r`, [queued.id, ok, error])).rows[0].r
    const exists = async () => (await db.query(`select count(*)::int as n from storage.objects where bucket_id = 'attachments' and name = $1`, [key])).rows[0].n

    resetStorageWorkerToken()
    const broken = createSupabaseStorageProvider({ ...config!, password: `wrong-${uid()}` })
    const failed = await broken.deleteObjects('attachments', [key])
    expect(failed.failed).toHaveLength(1)
    expect(await recordResult(false, failed.failed[0]!.error)).toBe('retry')
    expect(await exists()).toBe(1)

    resetStorageWorkerToken()
    const worker = createSupabaseStorageProvider(config!)
    expect(await worker.headObject('attachments', key)).toMatchObject({ size: TEST_TEXT.length })
    const removed = await worker.deleteObjects('attachments', [key])
    expect(removed.failed).toHaveLength(0)
    expect(await exists()).toBe(0)
    expect(await recordResult(true, null)).toBe('deleted')
    const file = (await db.query(`select status from public.storage_files where object_key = $1 order by created_at desc limit 1`, [key])).rows[0]
    expect(file.status).toBe('deleted')
    expect(await worker.headObject('attachments', key)).toBeNull()
  }, 60_000)
})

describe('Reminders and scheduled jobs', () => {
  it('two overlapping runs never claim the same reminder', async () => {
    const project = (await db.query(`insert into public.projects (user_id, name) values ($1, 'Reminders') returning id`, [u.member])).rows[0].id
    const task = (await db.query(`insert into public.tasks (user_id, project_id, title) values ($1, $2, 'remind me') returning id`, [u.member, project])).rows[0].id
    // Due tomorrow: production runs (window = now + 60 s) never touch it; the test uses a wider window.
    const reminder = (await db.query(
      `insert into public.task_reminders (user_id, task_id, project_id, remind_at, reminder_type) values ($1, $2, $3, now() + interval '1 day', '1h') returning id`,
      [u.member, task, project],
    )).rows[0].id
    const windowEnd = new Date(Date.now() + 2 * 86_400_000).toISOString()

    const runA = newClient()
    const runB = newClient()
    await Promise.all([runA.connect(), runB.connect()])
    try {
      await runA.query('begin')
      const claimedA = await claimDueReminders(runA as never, windowEnd)
      const claimedB = await claimDueReminders(runB as never, windowEnd)
      await runA.query('commit')
      const claimedBAgain = await claimDueReminders(runB as never, windowEnd)
      expect(claimedA).toContain(reminder)
      expect(claimedB).not.toContain(reminder)
      expect(claimedBAgain).not.toContain(reminder)
    } finally {
      await Promise.all([runA.end(), runB.end()])
    }
  }, 60_000)

  it('scheduled functions cannot be triggered from outside, even with a forged schedule header', async () => {
    for (const fn of ['scheduler']) {
      const forged = await fetch(`${APP}/.netlify/functions/${fn}`, { method: 'POST', headers: { 'x-netlify-event': 'schedule' } })
      expect(forged.status, fn).toBe(403)
      const querySecret = await fetch(`${APP}/.netlify/functions/${fn}?cron_secret=guess`, { method: 'POST' })
      expect(querySecret.status, fn).toBe(403)
    }
    // The database-triggered entry point is routed, so only its secret is accepted.
    const run = `${APP}/api/scheduler-run`
    expect((await fetch(run, { method: 'POST', headers: { 'x-netlify-event': 'schedule' } })).status).toBe(401)
    expect((await fetch(run, { method: 'POST', headers: { 'x-cron-secret': 'guess' } })).status).toBe(401)
    expect((await fetch(`${run}?cron_secret=guess`, { method: 'POST' })).status).toBe(401)
  })
})

describe('Database connections', () => {
  it('a failed connection is reported and the next request recovers', async () => {
    await expect(acquireDb('postgresql://user:pass@127.0.0.1:1/none')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    const client = await acquireDb(DATABASE_URL)
    try {
      const { rows } = await client.query('select 1 as ok')
      expect(rows[0].ok).toBe(1)
    } finally {
      client.release()
    }
  })
})

describe('Deployed account deletion', () => {
  it('self-service deletion removes the account and its personal files', async () => {
    const doomed = clients.doomed!
    const project = (await db.query(`insert into public.projects (user_id, name) values ($1, 'Doomed') returning id`, [u.doomed])).rows[0].id
    const task = (await db.query(`insert into public.tasks (user_id, project_id, title) values ($1, $2, 'doomed task') returning id`, [u.doomed, project])).rows[0].id
    const uploaded = await uploadVia(doomed, 'task', task, 'note.txt', 'bye')
    expect(uploaded.complete?.ok).toBe(true)
    const path = uploaded.slot.object_key
    const { data: session } = await doomed.auth.getSession()
    const response = await fetch(`${APP}/api/delete-account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.session!.access_token}`, 'Content-Type': 'application/json', Origin: APP },
      body: JSON.stringify({ confirm: 'DELETE' }),
    })
    expect(response.status).toBe(200)
    expect((await db.query(`select count(*)::int as n from auth.users where id = $1`, [u.doomed])).rows[0].n).toBe(0)
    expect((await db.query(`select count(*)::int as n from storage.objects where bucket_id = 'attachments' and name = $1`, [path])).rows[0].n).toBe(0)
  }, 60_000)
})
