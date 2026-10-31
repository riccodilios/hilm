/**
 * Database authorization tests. Everything runs inside one transaction that is rolled back at the
 * end: fixtures (users, workspaces, tasks) never persist. Queries run as real `authenticated` users
 * (JWT claims + role), so RLS, grants and triggers are exercised exactly as PostgREST and Realtime
 * apply them. SECURITY_APPLY_MIGRATIONS=1 applies 0043–0045 inside the same transaction first
 * (pre-flight against production before the real migration).
 */
import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { deleteUserAccount } from '../../netlify/functions/_shared/account-deletion'
import {
  asUser,
  attempt,
  createAuthUser,
  env,
  idsAs,
  nestedTransactionClient,
  newClient,
  refusedAs,
  testEmail,
  uid,
} from './helpers'

const MIGRATIONS = ['0043_workspace_isolation.sql', '0044_ai_cost_security.sql', '0045_integrity_and_deletion.sql']

const u = {
  owner: uid(),
  admin: uid(),
  headHR: uid(),
  memberHR: uid(),
  memberTech: uid(),
  leadTech: uid(),
  viewer: uid(),
  outsider: uid(),
  solo: uid(),
}
const emails: Record<string, string> = {}
const ids: Record<string, string> = {}
let client: pg.Client

async function one(sql: string, params: unknown[] = []) {
  const { rows } = await client.query(sql, params)
  return rows[0] as Record<string, unknown>
}

beforeAll(async () => {
  client = newClient()
  await client.connect()
  await client.query('begin')
  if (env.SECURITY_APPLY_MIGRATIONS === '1') {
    for (const file of MIGRATIONS) await client.query(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
  // Storage refuses SQL deletes unless this is set; it lets the tests exercise the delete policies.
  await client.query(`set local storage.allow_delete_query = 'true'`)

  for (const [label, id] of Object.entries(u)) {
    emails[label] = testEmail(label)
    await createAuthUser(client, id, emails[label]!)
  }

  const wsA = await asUser(client, u.owner, `select id from public.create_workspace('Security A', null, '#60a5fa')`)
  ids.wsA = wsA.rows[0].id
  const wsB = await asUser(client, u.outsider, `select id from public.create_workspace('Security B', null, '#60a5fa')`)
  ids.wsB = wsB.rows[0].id

  await client.query(
    `insert into public.workspace_members (workspace_id, user_id, role) values
       ($1, $2, 'admin'), ($1, $3, 'member'), ($1, $4, 'member'), ($1, $5, 'member'), ($1, $6, 'member'), ($1, $7, 'viewer')`,
    [ids.wsA, u.admin, u.headHR, u.memberHR, u.memberTech, u.leadTech, u.viewer],
  )

  ids.hr = String((await one(`insert into public.workspace_departments (workspace_id, name, head_user_id) values ($1, 'HR', $2) returning id`, [ids.wsA, u.headHR])).id)
  ids.payroll = String((await one(`insert into public.workspace_departments (workspace_id, name, parent_id) values ($1, 'Payroll', $2) returning id`, [ids.wsA, ids.hr])).id)
  ids.tech = String((await one(`insert into public.workspace_departments (workspace_id, name) values ($1, 'Tech') returning id`, [ids.wsA])).id)
  ids.deptB = String((await one(`insert into public.workspace_departments (workspace_id, name) values ($1, 'B dept') returning id`, [ids.wsB])).id)
  ids.techTeam = String((await one(`insert into public.workspace_teams (workspace_id, name, department_id, lead_user_id) values ($1, 'Tech team', $2, $3) returning id`, [ids.wsA, ids.tech, u.leadTech])).id)
  await client.query(`insert into public.workspace_team_members (workspace_id, team_id, user_id) values ($1, $2, $3)`, [ids.wsA, ids.techTeam, u.memberTech])
  await client.query(`insert into public.workspace_member_settings (workspace_id, user_id, department_id) values ($1, $2, $3)`, [ids.wsA, u.memberHR, ids.hr])

  ids.pOpen = String((await one(`insert into public.workspace_projects (workspace_id, created_by, name) values ($1, $2, 'Open project') returning id`, [ids.wsA, u.owner])).id)
  ids.pTech = String((await one(`insert into public.workspace_projects (workspace_id, created_by, name, team_id) values ($1, $2, 'Tech project', $3) returning id`, [ids.wsA, u.owner, ids.techTeam])).id)
  ids.pB = String((await one(`insert into public.workspace_projects (workspace_id, created_by, name) values ($1, $2, 'B project') returning id`, [ids.wsB, u.outsider])).id)

  const task = async (key: string, project: string, assignee: string | null, extra: { department?: string; team?: string } = {}) => {
    ids[key] = String(
      (
        await one(
          `insert into public.workspace_tasks (workspace_id, project_id, created_by, title, assignee_id, department_id, team_id)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [ids.wsA, project, u.owner, key, assignee, extra.department ?? null, extra.team ?? null],
        )
      ).id,
    )
  }
  await task('tHr', ids.pOpen, u.memberHR)
  await task('tTech', ids.pTech, u.memberTech)
  await task('tTechTaggedHr', ids.pOpen, u.memberTech, { department: ids.hr })
  await task('tInbox', ids.pTech, null, { team: ids.techTeam })
  await task('tOwner', ids.pOpen, u.owner)
  await task('tPayroll', ids.pOpen, null, { department: ids.payroll })
  ids.tB = String((await one(`insert into public.workspace_tasks (workspace_id, project_id, created_by, title) values ($1, $2, $3, 'B task') returning id`, [ids.wsB, ids.pB, u.outsider])).id)

  await asUser(client, u.memberHR, `insert into public.workspace_task_comments (workspace_id, task_id, author_user_id, content) values ($1, $2, $3, 'HR only')`, [ids.wsA, ids.tHr, u.memberHR])
  await client.query(
    `insert into public.workspace_activity_events (workspace_id, actor_id, event_type, entity_type, entity_id, summary)
     values ($1, $2, 'task.updated', 'task', $3, 'HR task changed')`,
    [ids.wsA, u.owner, ids.tHr],
  )
  ids.meeting = String((await one(`insert into public.workspace_meetings (workspace_id, project_id, created_by, title) values ($1, $2, $3, 'Tech sync') returning id`, [ids.wsA, ids.pTech, u.owner])).id)
  await client.query(
    `insert into public.workspace_meeting_transcript_segments (workspace_id, meeting_id, ordinal, start_ms, end_ms, text)
     values ($1, $2, 0, 0, 1000, 'secret roadmap')`,
    [ids.wsA, ids.meeting],
  )
  await asUser(client, u.owner, `insert into public.workspace_ai_reports (workspace_id, created_by, report_type, title, content_html, branding) values ($1, $2, 'status', 'Owner report', '<p>x</p>', '{}'::jsonb)`, [ids.wsA, u.owner])
  ids.crm = String((await asUser(client, u.owner, `insert into public.workspace_crm_integrations (workspace_id, provider, status, created_by) values ($1, 'hubspot', 'configured', $2) returning id`, [ids.wsA, u.owner])).rows[0].id)
  await asUser(client, u.owner, `select public.crm_set_credentials($1, 'api-key-123')`, [ids.crm])

  // Files: memberHR's attachment on the HR task.
  ids.hrObject = `workspace/${ids.wsA}/tasks/${ids.tHr}/1_hr.pdf`
  await asUser(client, u.memberHR, `insert into public.workspace_attachments (workspace_id, entity_type, entity_id, storage_path, filename, uploaded_by) values ($1, 'task', $2, $3, 'hr.pdf', $4)`, [ids.wsA, ids.tHr, ids.hrObject, u.memberHR])
  await asUser(client, u.memberHR, `insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)`, [ids.hrObject, u.memberHR])
}, 240_000)

afterAll(async () => {
  await client?.query('rollback').catch(() => undefined)
  await client?.end().catch(() => undefined)
})

describe('cross-workspace isolation', () => {
  it('an outsider reads nothing from another workspace', async () => {
    for (const table of ['workspace_tasks', 'workspace_projects', 'workspace_meetings', 'workspace_task_comments', 'workspace_attachments', 'workspace_activity_events', 'workspace_ai_reports', 'workspace_members', 'workspace_departments']) {
      const { rows } = await asUser(client, u.outsider, `select count(*)::int as n from public.${table} where workspace_id = $1`, [ids.wsA])
      expect(rows[0].n, table).toBe(0)
    }
    const objects = await asUser(client, u.outsider, `select count(*)::int as n from storage.objects where name like $1`, [`workspace/${ids.wsA}/%`])
    expect(objects.rows[0].n).toBe(0)
    const transcript = await asUser(client, u.outsider, `select count(*)::int as n from public.workspace_meeting_transcript_segments where meeting_id = $1`, [ids.meeting])
    expect(transcript.rows[0].n).toBe(0)
  })

  it('an outsider cannot write into another workspace', async () => {
    expect(await refusedAs(client, u.outsider, `insert into public.workspace_tasks (workspace_id, project_id, created_by, title) values ($1, $2, $3, 'x')`, [ids.wsA, ids.pOpen, u.outsider])).toBeTruthy()
    const update = await asUser(client, u.outsider, `update public.workspace_tasks set title = 'pwned' where id = $1`, [ids.tHr])
    expect(update.rowCount).toBe(0)
    const del = await asUser(client, u.outsider, `delete from public.workspace_projects where id = $1`, [ids.pOpen])
    expect(del.rowCount).toBe(0)
  })

  it('references across workspaces are refused even for owners', async () => {
    const crossProject = await refusedAs(client, u.outsider, `insert into public.workspace_tasks (workspace_id, project_id, created_by, title) values ($1, $2, $3, 'x')`, [ids.wsB, ids.pOpen, u.outsider])
    expect(crossProject?.message).toMatch(/cross_workspace_reference|row-level security/)
    const crossDept = await refusedAs(client, u.owner, `update public.workspace_tasks set department_id = $2 where id = $1`, [ids.tOwner, ids.deptB])
    expect(crossDept?.message).toMatch(/cross_workspace_reference/)
    const nonMember = await refusedAs(client, u.owner, `insert into public.workspace_team_members (workspace_id, team_id, user_id) values ($1, $2, $3)`, [ids.wsA, ids.techTeam, u.outsider])
    expect(nonMember?.message).toMatch(/cross_workspace_reference/)
    const moveWorkspace = await refusedAs(client, u.owner, `update public.workspace_tasks set workspace_id = $2 where id = $1`, [ids.tOwner, ids.wsB])
    expect(moveWorkspace).toBeTruthy()
  })
})

describe('department, team and member visibility', () => {
  const visible = (userId: string) =>
    idsAs(client, userId, `select id from public.workspace_tasks where workspace_id = $1`, [ids.wsA])
  const sorted = (...keys: string[]) => keys.map((key) => ids[key]!).sort()

  it('owners and admins see every task', async () => {
    const all = sorted('tHr', 'tTech', 'tTechTaggedHr', 'tInbox', 'tOwner', 'tPayroll')
    expect(await visible(u.owner)).toEqual(all)
    expect(await visible(u.admin)).toEqual(all)
  })

  it('a member sees only work assigned to (or created by) them', async () => {
    expect(await visible(u.memberTech)).toEqual(sorted('tTech', 'tTechTaggedHr'))
    expect(await visible(u.memberHR)).toEqual(sorted('tHr'))
  })

  it('a department head sees their department, sub-departments and its people only', async () => {
    // tTechTaggedHr is tagged HR but assigned to a Tech member: it follows the assignee to Tech.
    expect(await visible(u.headHR)).toEqual(sorted('tHr', 'tPayroll'))
  })

  it('a team lead sees unassigned work routed to their team', async () => {
    expect(await visible(u.leadTech)).toEqual(sorted('tInbox'))
  })

  it('a viewer without assignments sees no tasks', async () => {
    expect(await visible(u.viewer)).toEqual([])
  })

  it('projects: team projects are limited to their team; workspace-wide projects are shared', async () => {
    const projects = (userId: string) => idsAs(client, userId, `select id from public.workspace_projects where workspace_id = $1`, [ids.wsA])
    expect(await projects(u.memberHR)).toEqual([ids.pOpen].sort())
    expect(await projects(u.memberTech)).toEqual([ids.pOpen, ids.pTech].sort())
    expect(await projects(u.headHR)).toEqual([ids.pOpen].sort())
  })

  it('comments, activity and assignment history follow task visibility', async () => {
    const comments = (userId: string) => asUser(client, userId, `select count(*)::int as n from public.workspace_task_comments where task_id = $1`, [ids.tHr])
    expect((await comments(u.memberTech)).rows[0].n).toBe(0)
    expect((await comments(u.headHR)).rows[0].n).toBe(1)
    const activity = (userId: string) => asUser(client, userId, `select count(*)::int as n from public.workspace_activity_events where entity_id = $1`, [ids.tHr])
    expect((await activity(u.memberTech)).rows[0].n).toBe(0)
    expect((await activity(u.memberHR)).rows[0].n).toBe(1)
    const comment = await refusedAs(client, u.memberTech, `insert into public.workspace_task_comments (workspace_id, task_id, author_user_id, content) values ($1, $2, $3, 'peek')`, [ids.wsA, ids.tHr, u.memberTech])
    expect(comment).toBeTruthy()
  })

  it('meetings and transcripts follow project visibility', async () => {
    const meeting = (userId: string) => asUser(client, userId, `select count(*)::int as n from public.workspace_meeting_transcript_segments where meeting_id = $1`, [ids.meeting])
    expect((await meeting(u.memberHR)).rows[0].n).toBe(0)
    expect((await meeting(u.memberTech)).rows[0].n).toBe(1)
  })

  it('member settings: only your own row; colleagues through the safe directory', async () => {
    const direct = await asUser(client, u.memberTech, `select count(*)::int as n from public.workspace_member_settings where user_id = $1`, [u.memberHR])
    expect(direct.rows[0].n).toBe(0)
    const profiles = await asUser(client, u.memberTech, `select * from public.list_workspace_member_profiles($1) where user_id = $2`, [ids.wsA, u.memberHR])
    expect(profiles.rows[0]).toMatchObject({ user_id: u.memberHR, department_id: ids.hr })
    expect(Object.keys(profiles.rows[0])).not.toContain('notification_prefs')
    expect(Object.keys(profiles.rows[0])).not.toContain('ai_prefs')
  })

  it('the member directory hides colleagues’ emails from non-managers', async () => {
    const asMember = await asUser(client, u.memberTech, `select user_id, email from public.list_workspace_member_directory($1)`, [ids.wsA])
    const byId = new Map(asMember.rows.map((row) => [row.user_id, row.email]))
    expect(byId.get(u.owner)).toBeNull()
    expect(byId.get(u.memberTech)).toBe(emails.memberTech)
    const asAdmin = await asUser(client, u.admin, `select user_id, email from public.list_workspace_member_directory($1)`, [ids.wsA])
    expect(new Map(asAdmin.rows.map((row) => [row.user_id, row.email])).get(u.memberTech)).toBe(emails.memberTech)
  })

  it('saved workspace reports are visible to their author and owners/admins only', async () => {
    const count = (userId: string) => asUser(client, userId, `select count(*)::int as n from public.workspace_ai_reports where workspace_id = $1`, [ids.wsA])
    expect((await count(u.memberTech)).rows[0].n).toBe(0)
    expect((await count(u.admin)).rows[0].n).toBe(1)
  })
})

describe('role and permission corrections', () => {
  it('viewers cannot write tasks, reports or attachments', async () => {
    expect(await refusedAs(client, u.viewer, `insert into public.workspace_tasks (workspace_id, project_id, created_by, title) values ($1, $2, $3, 'v')`, [ids.wsA, ids.pOpen, u.viewer])).toBeTruthy()
    expect(await refusedAs(client, u.viewer, `insert into public.workspace_ai_reports (workspace_id, created_by, report_type, title, content_html, branding) values ($1, $2, 's', 't', '', '{}'::jsonb)`, [ids.wsA, u.viewer])).toBeTruthy()
    expect(await refusedAs(client, u.viewer, `insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)`, [`workspace/${ids.wsA}/tasks/${ids.tOwner}/1_v.pdf`, u.viewer])).toBeTruthy()
    const overwrite = await asUser(client, u.viewer, `update storage.objects set metadata = '{}'::jsonb where name = $1`, [ids.hrObject])
    expect(overwrite.rowCount).toBe(0)
    const remove = await asUser(client, u.viewer, `delete from storage.objects where name = $1`, [ids.hrObject])
    expect(remove.rowCount).toBe(0)
  })

  it('members cannot attach to tasks they cannot see, nor remove others’ files', async () => {
    expect(await refusedAs(client, u.memberTech, `insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)`, [`workspace/${ids.wsA}/tasks/${ids.tHr}/1_x.pdf`, u.memberTech])).toBeTruthy()
    const own = await attempt(client, u.memberTech, () =>
      client.query(`insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)`, [`workspace/${ids.wsA}/tasks/${ids.tTech}/1_ok.pdf`, u.memberTech]),
    )
    expect(own.ok).toBe(true)
    const removeOthers = await asUser(client, u.memberTech, `delete from storage.objects where name = $1`, [ids.hrObject])
    expect(removeOthers.rowCount).toBe(0)
    expect(await refusedAs(client, u.memberTech, `insert into public.workspace_attachments (workspace_id, entity_type, entity_id, storage_path, filename, uploaded_by) values ($1, 'task', $2, 'x', 'x', $3)`, [ids.wsA, ids.tHr, u.memberTech])).toBeTruthy()
  })

  it('owners and admins can remove any workspace file', async () => {
    const removed = await asUser(client, u.admin, `delete from storage.objects where name = $1`, [ids.hrObject])
    expect(removed.rowCount).toBe(1)
  })

  it('page permissions are enforced on writes (Tasks write turned off for a member)', async () => {
    await client.query(`update public.workspace_members set page_permissions = '{"tasks":{"read":true,"write":false}}' where workspace_id = $1 and user_id = $2`, [ids.wsA, u.memberTech])
    expect(await refusedAs(client, u.memberTech, `insert into public.workspace_tasks (workspace_id, project_id, created_by, title) values ($1, $2, $3, 'blocked')`, [ids.wsA, ids.pOpen, u.memberTech])).toBeTruthy()
    const update = await asUser(client, u.memberTech, `update public.workspace_tasks set title = 'blocked' where id = $1`, [ids.tTech])
    expect(update.rowCount).toBe(0)
    await client.query(`update public.workspace_members set page_permissions = '{}' where workspace_id = $1 and user_id = $2`, [ids.wsA, u.memberTech])
  })

  it('CRM credentials: managers only, stored in Vault, decrypted only server-side', async () => {
    const memberRead = await asUser(client, u.memberTech, `select count(*)::int as n from public.workspace_crm_integrations where workspace_id = $1`, [ids.wsA])
    expect(memberRead.rows[0].n).toBe(0)
    const ownerRead = await asUser(client, u.owner, `select credentials_encrypted from public.workspace_crm_integrations where id = $1`, [ids.crm])
    expect(String(ownerRead.rows[0].credentials_encrypted)).toMatch(/^vault:[0-9a-f-]{36}$/)
    expect(String(ownerRead.rows[0].credentials_encrypted)).not.toContain('api-key-123')
    expect(await refusedAs(client, u.owner, `update public.workspace_crm_integrations set credentials_encrypted = 'x' where id = $1`, [ids.crm])).toBeTruthy()
    expect(await refusedAs(client, u.memberTech, `select public.crm_set_credentials($1, 'steal')`, [ids.crm])).toBeTruthy()
    expect(await refusedAs(client, u.owner, `select private.crm_credentials($1)`, [ids.crm])).toBeTruthy()
    const serverSide = await client.query(`select private.crm_credentials($1) as secret`, [ids.crm])
    expect(serverSide.rows[0].secret).toBe('api-key-123')
  })

  it('invite codes: unknown codes are counted and limited per hour', async () => {
    for (let i = 0; i < 10; i += 1) {
      const result = await asUser(client, u.solo, `select (public.join_workspace_by_invite('ZZZZZZZZ')).id`)
      expect(result.rows[0].id).toBeNull()
    }
    const limited = await refusedAs(client, u.solo, `select public.join_workspace_by_invite('ZZZZZZZZ')`)
    expect(limited?.message).toMatch(/Too many invite attempts/)
  })
})

describe('AI access and cost', () => {
  it('users cannot raise their own AI tier', async () => {
    const escalate = await refusedAs(client, u.memberTech, `update public.profiles set ai_tier_id = 'team' where id = $1`, [u.memberTech])
    expect(escalate).toBeTruthy()
    const insert = await refusedAs(client, u.memberTech, `insert into public.profiles (id, ai_tier_id) values ($1, 'team') on conflict (id) do update set ai_tier_id = 'team'`, [u.memberTech])
    expect(insert).toBeTruthy()
    const rename = await asUser(client, u.memberTech, `update public.profiles set display_name = 'Renamed' where id = $1`, [u.memberTech])
    expect(rename.rowCount).toBe(1)
    const tier = await client.query(`select ai_tier_id from public.profiles where id = $1`, [u.memberTech])
    expect(tier.rows[0].ai_tier_id).toBe('free')
    await client.query(`select private.set_ai_tier($1, 'pro')`, [u.memberTech])
    expect((await client.query(`select ai_tier_id from public.profiles where id = $1`, [u.memberTech])).rows[0].ai_tier_id).toBe('pro')
    await client.query(`select private.set_ai_tier($1, 'free')`, [u.memberTech])
  })

  it('browsers cannot complete or rewrite usage events', async () => {
    expect(await refusedAs(client, u.memberTech, `select public.complete_ai_request($1, 'completed')`, [uid()])).toBeTruthy()
    expect(await refusedAs(client, u.memberTech, `select private.complete_ai_request($1, 'completed')`, [uid()])).toBeTruthy()
  })

  it('billed failures count toward spend, and an event completes only once', async () => {
    const began = await asUser(client, u.memberTech, `select public.begin_ai_request('chat', 'google/gemini-2.5-flash') as r`)
    const eventId = began.rows[0].r.event_id as string
    expect(began.rows[0].r.ok).toBe(true)
    const failed = await client.query(`select private.complete_ai_request($1, 'failed', 100000, 50000, 'google/gemini-2.5-flash', 'provider_error') as r`, [eventId])
    expect(Number(failed.rows[0].r.estimated_cost_usd)).toBeGreaterThan(0)
    const again = await client.query(`select private.complete_ai_request($1, 'completed', 0, 0) as r`, [eventId])
    expect(again.rows[0].r.code).toBe('already_completed')
    const summary = await asUser(client, u.memberTech, `select public.get_ai_usage_summary() as s`)
    expect(Number(summary.rows[0].s.usage.cost_day)).toBeGreaterThan(0)
  })

  it('usage is never attributed to a workspace the caller does not belong to', async () => {
    const began = await asUser(client, u.memberTech, `select public.begin_ai_request('chat', null, $1) as r`, [ids.wsB])
    const row = await client.query(`select workspace_id from public.ai_usage_events where id = $1`, [began.rows[0].r.event_id])
    expect(row.rows[0].workspace_id).toBeNull()
  })

  it('the global daily safeguard applies even when the cap is left empty', async () => {
    await client.query(`update public.ai_runtime_controls set max_global_daily_cost_usd = null where id = 'global'`)
    await client.query(
      `insert into public.ai_usage_events (user_id, request_kind, status, estimated_cost_usd, completed_at)
       values ($1, 'chat', 'completed', 1000, now())`,
      [u.solo],
    )
    const began = await asUser(client, u.memberHR, `select public.begin_ai_request('chat') as r`)
    expect(began.rows[0].r.code).toBe('global_cost_limit')
  })
})

describe('data integrity and deletion', () => {
  it('personal records cannot reference another user’s projects or tasks', async () => {
    const project = await asUser(client, u.solo, `insert into public.projects (user_id, name) values ($1, 'Solo') returning id`, [u.solo])
    const projectId = project.rows[0].id
    const task = await asUser(client, u.solo, `insert into public.tasks (user_id, project_id, title) values ($1, $2, 'Solo task') returning id`, [u.solo, projectId])
    ids.soloTask = task.rows[0].id
    ids.soloProject = projectId
    const foreignTask = await refusedAs(client, u.memberTech, `insert into public.tasks (user_id, project_id, title) values ($1, $2, 'hijack')`, [u.memberTech, projectId])
    expect(foreignTask?.message).toMatch(/cross_user_reference/)
    const foreignSubtask = await refusedAs(client, u.memberTech, `insert into public.subtasks (user_id, task_id, title) values ($1, $2, 'x')`, [u.memberTech, ids.soloTask])
    expect(foreignSubtask?.message).toMatch(/cross_user_reference/)
  })

  it('deleting a task removes its attachment rows and records the file for Storage', async () => {
    const path = `${u.solo}/tasks/${ids.soloTask}/1_doc.pdf`
    await asUser(client, u.solo, `insert into public.attachments (user_id, entity_type, entity_id, storage_path, filename) values ($1, 'task', $2, $3, 'doc.pdf')`, [u.solo, ids.soloTask, path])
    await asUser(client, u.solo, `delete from public.tasks where id = $1`, [ids.soloTask])
    const rows = await client.query(`select count(*)::int as n from public.attachments where entity_id = $1`, [ids.soloTask])
    expect(rows.rows[0].n).toBe(0)
    const queued = await client.query(`select count(*)::int as n from private.storage_object_deletions where bucket_id = 'attachments' and object_name = $1 and processed_at is null`, [path])
    expect(queued.rows[0].n).toBe(1)
  })

  it('account deletion succeeds and keeps shared workspace data', async () => {
    // memberTech created a task and uploaded a file in the shared workspace.
    const created = await asUser(client, u.memberTech, `insert into public.workspace_tasks (workspace_id, project_id, created_by, title, assignee_id) values ($1, $2, $3, 'by tech', $3) returning id`, [ids.wsA, ids.pTech, u.memberTech])
    const createdId = created.rows[0].id
    await asUser(client, u.memberTech, `insert into public.workspace_attachments (workspace_id, entity_type, entity_id, storage_path, filename, uploaded_by) values ($1, 'task', $2, 'p', 'f', $3)`, [ids.wsA, ids.tTech, u.memberTech])
    const meeting = await asUser(client, u.memberTech, `insert into public.workspace_meetings (workspace_id, project_id, created_by, title) values ($1, $2, $3, 'tech meeting') returning id`, [ids.wsA, ids.pTech, u.memberTech])

    const result = await deleteUserAccount(nestedTransactionClient(client) as never, u.memberTech)
    expect(result.ok).toBe(true)
    expect((await client.query(`select count(*)::int as n from auth.users where id = $1`, [u.memberTech])).rows[0].n).toBe(0)
    expect((await client.query(`select count(*)::int as n from public.workspace_tasks where id = $1`, [createdId])).rows[0].n).toBe(1)
    expect((await client.query(`select count(*)::int as n from public.workspace_attachments where entity_id = $1 and uploaded_by is null`, [ids.tTech])).rows[0].n).toBe(1)
    expect((await client.query(`select count(*)::int as n from public.workspace_meetings where id = $1`, [meeting.rows[0].id])).rows[0].n).toBe(1)
    expect((await client.query(`select assignee_id from public.workspace_tasks where id = $1`, [ids.tTech])).rows[0].assignee_id).toBeNull()
  })

  it('a user with personal projects and tasks can delete their account', async () => {
    const project = await asUser(client, u.solo, `insert into public.projects (user_id, name) values ($1, 'Another') returning id`, [u.solo])
    await asUser(client, u.solo, `insert into public.tasks (user_id, project_id, title) values ($1, $2, 'kept until account deletion')`, [u.solo, project.rows[0].id])
    const result = await deleteUserAccount(nestedTransactionClient(client) as never, u.solo)
    expect(result.ok).toBe(true)
  })

  it('a single personal project with tasks still cannot be hard-deleted', async () => {
    const project = await asUser(client, u.headHR, `insert into public.projects (user_id, name) values ($1, 'Keep') returning id`, [u.headHR])
    await asUser(client, u.headHR, `insert into public.tasks (user_id, project_id, title) values ($1, $2, 't')`, [u.headHR, project.rows[0].id])
    expect(await refusedAs(client, u.headHR, `delete from public.projects where id = $1`, [project.rows[0].id])).toBeTruthy()
  })
})
