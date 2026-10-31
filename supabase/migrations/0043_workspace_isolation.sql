-- Workspace and organizational isolation enforced in the database.
--
-- Until now any workspace member could read every task, comment, meeting, attachment, saved report
-- and member setting in the workspace; department and team visibility existed only in the browser.
-- This migration moves those rules into RLS (Realtime postgres_changes applies the same SELECT
-- policies per subscriber), validates page permissions on writes, keeps every reference inside its
-- own workspace, and narrows directory, member-settings and CRM exposure.
--
-- Visibility (mirrors src/features/workspace-os/lib/member-visibility.ts):
--   owner/admin          every record in the workspace
--   anyone               tasks assigned to or created by them
--   team lead            unassigned tasks routed to a team they lead (or its department)
--   department head      tasks whose department (assignee's department first) is one they head or below
--   projects             team-less projects, their team's projects, projects with a task they can see
--   meetings             meetings they created or whose project they can see

-- ── Department of a person (home department, else headed, else led team, else team membership) ──
create or replace function public.workspace_member_department(p_ws uuid, p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.department_id
       from public.workspace_member_settings s
       join public.workspace_departments d on d.id = s.department_id and d.workspace_id = p_ws
      where s.workspace_id = p_ws and s.user_id = p_user),
    (select d.id from public.workspace_departments d
      where d.workspace_id = p_ws and d.head_user_id = p_user
      order by d.name, d.id limit 1),
    (select t.department_id from public.workspace_teams t
      where t.workspace_id = p_ws and t.lead_user_id = p_user and t.department_id is not null
      order by t.name, t.id limit 1),
    (select t.department_id
       from public.workspace_team_members m
       join public.workspace_teams t on t.id = m.team_id
      where m.workspace_id = p_ws and m.user_id = p_user and t.department_id is not null
      order by m.created_at, m.id limit 1)
  );
$$;

-- Departments the caller heads, with every department below them.
create or replace function public.workspace_headed_department_ids(p_ws uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive tree as (
    select d.id from public.workspace_departments d
    where d.workspace_id = p_ws and d.head_user_id = auth.uid()
    union
    select c.id from public.workspace_departments c
    join tree on c.parent_id = tree.id
    where c.workspace_id = p_ws
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from tree;
$$;

-- The department a task counts under: its assignee's, else its own, else its team's.
create or replace function public.workspace_task_department(p_ws uuid, p_assignee uuid, p_department uuid, p_team uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case when p_assignee is not null then public.workspace_member_department(p_ws, p_assignee) end,
    p_department,
    (select t.department_id from public.workspace_teams t where t.id = p_team and t.workspace_id = p_ws)
  );
$$;

create or replace function public.workspace_sees_all(p_ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_member_role(p_ws) in ('owner', 'admin'), false);
$$;

create or replace function public.workspace_task_visible(
  p_ws uuid, p_assignee uuid, p_created_by uuid, p_department uuid, p_team uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.workspace_role;
  v_heads uuid[];
begin
  if v_uid is null or p_ws is null then
    return false;
  end if;
  select m.role into v_role from public.workspace_members m where m.workspace_id = p_ws and m.user_id = v_uid;
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin') then
    return true;
  end if;
  if p_assignee = v_uid or p_created_by = v_uid then
    return true;
  end if;
  -- Team lead inbox: unassigned work routed to their team, or to their team's department.
  if p_assignee is null and (
    (p_team is not null and exists (
      select 1 from public.workspace_teams t
      where t.id = p_team and t.workspace_id = p_ws and t.lead_user_id = v_uid))
    or (p_team is null and p_department is not null and exists (
      select 1 from public.workspace_teams t
      where t.workspace_id = p_ws and t.lead_user_id = v_uid and t.department_id = p_department))
  ) then
    return true;
  end if;
  v_heads := public.workspace_headed_department_ids(p_ws);
  if cardinality(v_heads) = 0 then
    return false;
  end if;
  return public.workspace_task_department(p_ws, p_assignee, p_department, p_team) = any(v_heads);
end;
$$;

create or replace function public.workspace_task_visible_by_id(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.workspace_task_visible(t.workspace_id, t.assignee_id, t.created_by, t.department_id, t.team_id)
    from public.workspace_tasks t where t.id = p_task_id
  ), false);
$$;

create or replace function public.workspace_project_visible(p_ws uuid, p_project uuid, p_team uuid, p_created_by uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.workspace_role;
  v_team_department uuid;
begin
  if v_uid is null or p_ws is null then
    return false;
  end if;
  select m.role into v_role from public.workspace_members m where m.workspace_id = p_ws and m.user_id = v_uid;
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin') or p_created_by = v_uid or p_team is null then
    return true;
  end if;
  select t.department_id into v_team_department
  from public.workspace_teams t where t.id = p_team and t.workspace_id = p_ws;
  if exists (select 1 from public.workspace_teams t where t.id = p_team and t.lead_user_id = v_uid)
     or exists (select 1 from public.workspace_team_members m where m.team_id = p_team and m.user_id = v_uid)
     or (v_team_department is not null and v_team_department = any(public.workspace_headed_department_ids(p_ws))) then
    return true;
  end if;
  return exists (
    select 1 from public.workspace_tasks t
    where t.project_id = p_project
      and public.workspace_task_visible(t.workspace_id, t.assignee_id, t.created_by, t.department_id, t.team_id)
  );
end;
$$;

create or replace function public.workspace_project_visible_by_id(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.workspace_project_visible(p.workspace_id, p.id, p.team_id, p.created_by)
    from public.workspace_projects p where p.id = p_project_id
  ), false);
$$;

create or replace function public.workspace_meeting_visible(p_ws uuid, p_project uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_workspace_member(p_ws)
    and (p_created_by = auth.uid() or public.workspace_project_visible_by_id(p_project));
$$;

create or replace function public.workspace_meeting_visible_by_id(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.workspace_meeting_visible(m.workspace_id, m.project_id, m.created_by)
    from public.workspace_meetings m where m.id = p_meeting_id
  ), false);
$$;

-- ── Page permissions (mirrors src/features/workspace-os/lib/page-permissions.ts) ──────────────
create or replace function public.workspace_page_access(p_ws uuid, p_page text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.workspace_role;
  v_perms jsonb;
  v_entry jsonb;
  v_read boolean;
  v_write boolean;
  v_leads boolean;
begin
  select m.role, m.page_permissions into v_role, v_perms
  from public.workspace_members m where m.workspace_id = p_ws and m.user_id = auth.uid();
  if v_role is null then
    return 'none';
  end if;
  if v_role in ('owner', 'admin') then
    return 'write';
  end if;
  v_entry := coalesce(v_perms, '{}'::jsonb) -> p_page;
  if v_entry is not null and jsonb_typeof(v_entry) = 'object' then
    v_read := (v_entry -> 'read') = 'true'::jsonb;
    v_write := v_read and (v_entry -> 'write') = 'true'::jsonb;
  elsif v_role = 'viewer' then
    v_read := p_page in ('home', 'projects', 'tasks', 'team', 'activity', 'reports', 'mission-control');
    v_write := false;
  elsif p_page = 'team-lead' then
    v_leads := exists (select 1 from public.workspace_teams t where t.workspace_id = p_ws and t.lead_user_id = auth.uid())
      or exists (select 1 from public.workspace_departments d where d.workspace_id = p_ws and d.head_user_id = auth.uid());
    v_read := v_leads;
    v_write := v_leads;
  else
    v_read := p_page in ('home', 'projects', 'tasks', 'ai', 'team', 'profile', 'activity', 'reports', 'mission-control');
    v_write := p_page in ('home', 'projects', 'tasks', 'ai', 'profile', 'reports');
  end if;
  if v_role = 'viewer' then
    v_write := false;
  end if;
  return case when v_write then 'write' when v_read then 'read' else 'none' end;
end;
$$;

create or replace function public.workspace_can_write_page(p_ws uuid, p_page text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_edit_workspace_content(p_ws) and public.workspace_page_access(p_ws, p_page) = 'write';
$$;

-- A project check that also requires membership (0042 version answered for any caller).
create or replace function public.workspace_project_in_workspace(p_project_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_workspace_member(p_workspace_id) and exists (
    select 1 from public.workspace_projects p
    where p.id = p_project_id and p.workspace_id = p_workspace_id
  );
$$;

-- Storage path helpers: workspace/{ws}/tasks/{task}/file and workspace/{ws}/{meeting}/{idx}.wav
create or replace function public.workspace_attachment_object_task(p_name text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
  from public.workspace_tasks t
  where (storage.foldername(p_name))[1] = 'workspace'
    and (storage.foldername(p_name))[3] = 'tasks'
    and t.id = public.try_uuid((storage.foldername(p_name))[4])
    and t.workspace_id = public.try_uuid((storage.foldername(p_name))[2]);
$$;

create or replace function public.workspace_audio_object_meeting(p_name text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
  from public.workspace_meetings m
  where (storage.foldername(p_name))[1] = 'workspace'
    and m.id = public.try_uuid((storage.foldername(p_name))[3])
    and m.workspace_id = public.try_uuid((storage.foldername(p_name))[2]);
$$;

create index if not exists workspace_departments_head_idx on public.workspace_departments (workspace_id, head_user_id);
create index if not exists workspace_teams_lead_idx on public.workspace_teams (workspace_id, lead_user_id);
create index if not exists workspace_team_members_user_idx on public.workspace_team_members (workspace_id, user_id);
create index if not exists workspace_tasks_project_idx on public.workspace_tasks (project_id);

-- ── Tasks ─────────────────────────────────────────────────────────────────────────────────────
drop policy if exists workspace_tasks_select on public.workspace_tasks;
create policy workspace_tasks_select on public.workspace_tasks
  for select using (public.workspace_task_visible(workspace_id, assignee_id, created_by, department_id, team_id));

drop policy if exists workspace_tasks_insert on public.workspace_tasks;
create policy workspace_tasks_insert on public.workspace_tasks
  for insert with check (public.workspace_can_write_page(workspace_id, 'tasks') and created_by = auth.uid());

-- Reassigning may move a task out of the editor's view, so WITH CHECK does not require visibility.
drop policy if exists workspace_tasks_update on public.workspace_tasks;
create policy workspace_tasks_update on public.workspace_tasks
  for update
  using (
    public.workspace_can_write_page(workspace_id, 'tasks')
    and public.workspace_task_visible(workspace_id, assignee_id, created_by, department_id, team_id)
  )
  with check (public.workspace_can_write_page(workspace_id, 'tasks'));

drop policy if exists workspace_tasks_delete on public.workspace_tasks;
create policy workspace_tasks_delete on public.workspace_tasks
  for delete using (
    public.workspace_can_write_page(workspace_id, 'tasks')
    and public.workspace_task_visible(workspace_id, assignee_id, created_by, department_id, team_id)
  );

-- ── Projects ──────────────────────────────────────────────────────────────────────────────────
drop policy if exists workspace_projects_select on public.workspace_projects;
create policy workspace_projects_select on public.workspace_projects
  for select using (public.workspace_project_visible(workspace_id, id, team_id, created_by));

drop policy if exists workspace_projects_insert on public.workspace_projects;
create policy workspace_projects_insert on public.workspace_projects
  for insert with check (public.workspace_can_write_page(workspace_id, 'projects') and created_by = auth.uid());

drop policy if exists workspace_projects_update on public.workspace_projects;
create policy workspace_projects_update on public.workspace_projects
  for update
  using (
    public.workspace_can_write_page(workspace_id, 'projects')
    and public.workspace_project_visible(workspace_id, id, team_id, created_by)
  )
  with check (public.workspace_can_write_page(workspace_id, 'projects'));

drop policy if exists workspace_projects_delete on public.workspace_projects;
create policy workspace_projects_delete on public.workspace_projects
  for delete using (
    public.workspace_can_write_page(workspace_id, 'projects')
    and public.workspace_project_visible(workspace_id, id, team_id, created_by)
  );

drop policy if exists workspace_project_labels_select on public.workspace_project_labels;
create policy workspace_project_labels_select on public.workspace_project_labels
  for select using (public.workspace_project_visible_by_id(project_id));
drop policy if exists workspace_project_labels_insert on public.workspace_project_labels;
create policy workspace_project_labels_insert on public.workspace_project_labels
  for insert with check (
    public.workspace_can_write_page(workspace_id, 'projects') and public.workspace_project_visible_by_id(project_id)
  );
drop policy if exists workspace_project_labels_delete on public.workspace_project_labels;
create policy workspace_project_labels_delete on public.workspace_project_labels
  for delete using (
    public.workspace_can_write_page(workspace_id, 'projects') and public.workspace_project_visible_by_id(project_id)
  );

-- Roadmap and notes follow their project.
drop policy if exists workspace_roadmap_items_select on public.workspace_roadmap_items;
create policy workspace_roadmap_items_select on public.workspace_roadmap_items
  for select using (public.workspace_project_visible_by_id(project_id));
drop policy if exists workspace_roadmap_items_insert on public.workspace_roadmap_items;
create policy workspace_roadmap_items_insert on public.workspace_roadmap_items
  for insert with check (
    public.workspace_can_write_page(workspace_id, 'projects')
    and created_by = auth.uid()
    and public.workspace_project_in_workspace(project_id, workspace_id)
    and public.workspace_project_visible_by_id(project_id)
  );
drop policy if exists workspace_roadmap_items_update on public.workspace_roadmap_items;
create policy workspace_roadmap_items_update on public.workspace_roadmap_items
  for update
  using (public.workspace_can_write_page(workspace_id, 'projects') and public.workspace_project_visible_by_id(project_id))
  with check (
    public.workspace_can_write_page(workspace_id, 'projects')
    and public.workspace_project_in_workspace(project_id, workspace_id)
  );
drop policy if exists workspace_roadmap_items_delete on public.workspace_roadmap_items;
create policy workspace_roadmap_items_delete on public.workspace_roadmap_items
  for delete using (
    public.workspace_can_write_page(workspace_id, 'projects') and public.workspace_project_visible_by_id(project_id)
  );

drop policy if exists workspace_project_notes_select on public.workspace_project_notes;
create policy workspace_project_notes_select on public.workspace_project_notes
  for select using (public.workspace_project_visible_by_id(project_id));
drop policy if exists workspace_project_notes_insert on public.workspace_project_notes;
create policy workspace_project_notes_insert on public.workspace_project_notes
  for insert with check (
    public.workspace_can_write_page(workspace_id, 'projects')
    and created_by = auth.uid()
    and public.workspace_project_in_workspace(project_id, workspace_id)
    and public.workspace_project_visible_by_id(project_id)
  );
drop policy if exists workspace_project_notes_update on public.workspace_project_notes;
create policy workspace_project_notes_update on public.workspace_project_notes
  for update
  using (public.workspace_can_write_page(workspace_id, 'projects') and public.workspace_project_visible_by_id(project_id))
  with check (
    public.workspace_can_write_page(workspace_id, 'projects')
    and public.workspace_project_in_workspace(project_id, workspace_id)
  );
drop policy if exists workspace_project_notes_delete on public.workspace_project_notes;
create policy workspace_project_notes_delete on public.workspace_project_notes
  for delete using (
    public.workspace_can_write_page(workspace_id, 'projects') and public.workspace_project_visible_by_id(project_id)
  );

-- ── Comments, mentions, assignment history ────────────────────────────────────────────────────
drop policy if exists workspace_task_comments_select on public.workspace_task_comments;
create policy workspace_task_comments_select on public.workspace_task_comments
  for select using (public.workspace_task_visible_by_id(task_id));

drop policy if exists workspace_task_comments_insert on public.workspace_task_comments;
create policy workspace_task_comments_insert on public.workspace_task_comments
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and author_user_id = auth.uid()
    and public.workspace_task_visible_by_id(task_id)
  );

drop policy if exists workspace_task_comments_update on public.workspace_task_comments;
create policy workspace_task_comments_update on public.workspace_task_comments
  for update
  using (
    public.can_edit_workspace_content(workspace_id)
    and author_user_id = auth.uid()
    and public.workspace_task_visible_by_id(task_id)
  )
  with check (public.can_edit_workspace_content(workspace_id) and author_user_id = auth.uid());

drop policy if exists workspace_comment_mentions_select on public.workspace_comment_mentions;
create policy workspace_comment_mentions_select on public.workspace_comment_mentions
  for select using (
    mentioned_user_id = auth.uid()
    or exists (
      select 1 from public.workspace_task_comments c
      where c.id = comment_id and public.workspace_task_visible_by_id(c.task_id)
    )
  );

-- 0024's check compared c.workspace_id with itself; compare it with the mention's workspace.
drop policy if exists workspace_comment_mentions_insert on public.workspace_comment_mentions;
create policy workspace_comment_mentions_insert on public.workspace_comment_mentions
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and exists (
      select 1 from public.workspace_task_comments c
      where c.id = workspace_comment_mentions.comment_id
        and c.workspace_id = workspace_comment_mentions.workspace_id
        and c.author_user_id = auth.uid()
    )
  );

drop policy if exists workspace_assignment_events_select on public.workspace_assignment_events;
create policy workspace_assignment_events_select on public.workspace_assignment_events
  for select using (public.workspace_task_visible_by_id(task_id));
drop policy if exists workspace_assignment_events_insert on public.workspace_assignment_events;
create policy workspace_assignment_events_insert on public.workspace_assignment_events
  for insert with check (
    public.workspace_can_write_page(workspace_id, 'tasks')
    and (actor_id is null or actor_id = auth.uid())
  );

-- ── Activity feed: only events about things the reader can see ────────────────────────────────
drop policy if exists workspace_activity_select on public.workspace_activity_events;
create policy workspace_activity_select on public.workspace_activity_events
  for select using (
    public.is_workspace_member(workspace_id)
    and (
      public.workspace_sees_all(workspace_id)
      or actor_id = auth.uid()
      or case entity_type
        when 'task' then public.workspace_task_visible_by_id(entity_id)
        when 'project' then public.workspace_project_visible_by_id(entity_id)
        when 'meeting' then public.workspace_meeting_visible_by_id(entity_id)
        when 'report' then false
        else true
      end
    )
  );

-- ── Attachments: metadata and Storage objects ─────────────────────────────────────────────────
drop policy if exists workspace_attachments_select on public.workspace_attachments;
create policy workspace_attachments_select on public.workspace_attachments
  for select using (
    case when entity_type = 'task'
      then public.workspace_task_visible_by_id(entity_id)
      else public.workspace_sees_all(workspace_id)
    end
  );

drop policy if exists workspace_attachments_insert on public.workspace_attachments;
create policy workspace_attachments_insert on public.workspace_attachments
  for insert with check (
    public.workspace_can_write_page(workspace_id, 'tasks')
    and uploaded_by = auth.uid()
    and entity_type = 'task'
    and public.workspace_task_visible_by_id(entity_id)
  );

drop policy if exists workspace_attachments_delete on public.workspace_attachments;
create policy workspace_attachments_delete on public.workspace_attachments
  for delete using (
    public.can_manage_workspace(workspace_id)
    or (uploaded_by = auth.uid() and public.workspace_can_write_page(workspace_id, 'tasks'))
  );

-- Workspace task files: read when the task is visible; write only with Tasks write access;
-- overwrite or delete only your own uploads (managers may remove any).
drop policy if exists attachments_storage_workspace on storage.objects;
drop policy if exists attachments_ws_select on storage.objects;
create policy attachments_ws_select on storage.objects
  for select using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'workspace'
    and public.workspace_task_visible_by_id(public.workspace_attachment_object_task(name))
  );

drop policy if exists attachments_ws_insert on storage.objects;
create policy attachments_ws_insert on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'workspace'
    and public.workspace_attachment_object_task(name) is not null
    and public.workspace_can_write_page(public.try_uuid((storage.foldername(name))[2]), 'tasks')
    and public.workspace_task_visible_by_id(public.workspace_attachment_object_task(name))
  );

drop policy if exists attachments_ws_update on storage.objects;
create policy attachments_ws_update on storage.objects
  for update using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'workspace'
    and public.workspace_can_write_page(public.try_uuid((storage.foldername(name))[2]), 'tasks')
    and (
      coalesce(owner_id, owner::text) = auth.uid()::text
      or public.can_manage_workspace(public.try_uuid((storage.foldername(name))[2]))
    )
  );

drop policy if exists attachments_ws_delete on storage.objects;
create policy attachments_ws_delete on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'workspace'
    and (
      public.can_manage_workspace(public.try_uuid((storage.foldername(name))[2]))
      or (
        coalesce(owner_id, owner::text) = auth.uid()::text
        and public.workspace_can_write_page(public.try_uuid((storage.foldername(name))[2]), 'tasks')
      )
    )
  );

-- ── Meetings, transcripts, recordings ─────────────────────────────────────────────────────────
drop policy if exists workspace_meetings_select on public.workspace_meetings;
create policy workspace_meetings_select on public.workspace_meetings
  for select using (public.workspace_meeting_visible(workspace_id, project_id, created_by));

drop policy if exists workspace_meetings_insert on public.workspace_meetings;
create policy workspace_meetings_insert on public.workspace_meetings
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and created_by = auth.uid()
    and exists (
      select 1 from public.workspace_projects p
      where p.id = workspace_meetings.project_id and p.workspace_id = workspace_meetings.workspace_id
    )
    and public.workspace_project_visible_by_id(project_id)
  );

drop policy if exists workspace_meetings_update on public.workspace_meetings;
create policy workspace_meetings_update on public.workspace_meetings
  for update
  using (
    public.can_edit_workspace_content(workspace_id)
    and public.workspace_meeting_visible(workspace_id, project_id, created_by)
  )
  with check (public.can_edit_workspace_content(workspace_id));

drop policy if exists workspace_meetings_delete on public.workspace_meetings;
create policy workspace_meetings_delete on public.workspace_meetings
  for delete using (
    (created_by = auth.uid() or public.can_manage_workspace(workspace_id))
    and public.workspace_meeting_visible(workspace_id, project_id, created_by)
  );

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_meeting_speakers', 'workspace_meeting_transcript_segments', 'workspace_meeting_decisions',
    'workspace_meeting_action_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.workspace_meeting_visible_by_id(meeting_id))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all
         using (public.can_edit_workspace_content(workspace_id) and public.workspace_meeting_visible_by_id(meeting_id))
         with check (public.can_edit_workspace_content(workspace_id) and public.workspace_meeting_visible_by_id(meeting_id))',
      t || '_write', t);
  end loop;
end $$;

drop policy if exists workspace_meeting_translations_select on public.workspace_meeting_translations;
create policy workspace_meeting_translations_select on public.workspace_meeting_translations
  for select using (public.workspace_meeting_visible_by_id(meeting_id));
drop policy if exists workspace_meeting_translations_write on public.workspace_meeting_translations;
create policy workspace_meeting_translations_write on public.workspace_meeting_translations
  for all
  using (public.can_edit_workspace_content(workspace_id) and public.workspace_meeting_visible_by_id(meeting_id))
  with check (
    public.can_edit_workspace_content(workspace_id)
    and public.workspace_meeting_visible_by_id(meeting_id)
    and exists (
      select 1 from public.workspace_meetings m
      where m.id = workspace_meeting_translations.meeting_id
        and m.workspace_id = workspace_meeting_translations.workspace_id
    )
  );

drop policy if exists workspace_meeting_audio_select on public.workspace_meeting_audio_segments;
create policy workspace_meeting_audio_select on public.workspace_meeting_audio_segments
  for select using (public.workspace_meeting_visible_by_id(meeting_id));
drop policy if exists workspace_meeting_audio_update on public.workspace_meeting_audio_segments;
create policy workspace_meeting_audio_update on public.workspace_meeting_audio_segments
  for update
  using (public.can_edit_workspace_content(workspace_id) and public.workspace_meeting_visible_by_id(meeting_id))
  with check (public.can_edit_workspace_content(workspace_id) and public.workspace_meeting_visible_by_id(meeting_id));
drop policy if exists workspace_meeting_audio_delete on public.workspace_meeting_audio_segments;
create policy workspace_meeting_audio_delete on public.workspace_meeting_audio_segments
  for delete using (public.can_edit_workspace_content(workspace_id) and public.workspace_meeting_visible_by_id(meeting_id));

drop policy if exists meeting_audio_workspace_select on storage.objects;
create policy meeting_audio_workspace_select on storage.objects
  for select using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = 'workspace'
    and public.workspace_meeting_visible_by_id(public.workspace_audio_object_meeting(name))
  );
drop policy if exists meeting_audio_workspace_insert on storage.objects;
create policy meeting_audio_workspace_insert on storage.objects
  for insert with check (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = 'workspace'
    and public.can_edit_workspace_content(public.try_uuid((storage.foldername(name))[2]))
    and public.workspace_meeting_visible_by_id(public.workspace_audio_object_meeting(name))
  );
drop policy if exists meeting_audio_workspace_update on storage.objects;
create policy meeting_audio_workspace_update on storage.objects
  for update using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = 'workspace'
    and public.can_edit_workspace_content(public.try_uuid((storage.foldername(name))[2]))
    and public.workspace_meeting_visible_by_id(public.workspace_audio_object_meeting(name))
  );
drop policy if exists meeting_audio_workspace_delete on storage.objects;
create policy meeting_audio_workspace_delete on storage.objects
  for delete using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = 'workspace'
    and public.can_edit_workspace_content(public.try_uuid((storage.foldername(name))[2]))
    and public.workspace_meeting_visible_by_id(public.workspace_audio_object_meeting(name))
  );

-- ── Saved reports: a snapshot holds whatever its author could see ─────────────────────────────
drop policy if exists workspace_ai_reports_select on public.workspace_ai_reports;
create policy workspace_ai_reports_select on public.workspace_ai_reports
  for select using (
    public.is_workspace_member(workspace_id)
    and (created_by = auth.uid() or public.workspace_sees_all(workspace_id))
  );
drop policy if exists workspace_ai_reports_insert on public.workspace_ai_reports;
create policy workspace_ai_reports_insert on public.workspace_ai_reports
  for insert with check (public.workspace_can_write_page(workspace_id, 'reports') and created_by = auth.uid());

-- ── Load balancer history ─────────────────────────────────────────────────────────────────────
drop policy if exists workspace_lb_runs_select on public.workspace_load_balance_runs;
create policy workspace_lb_runs_select on public.workspace_load_balance_runs
  for select using (
    public.is_workspace_member(workspace_id)
    and (created_by = auth.uid() or public.workspace_sees_all(workspace_id))
  );
drop policy if exists workspace_lb_sugg_select on public.workspace_load_balance_suggestions;
create policy workspace_lb_sugg_select on public.workspace_load_balance_suggestions
  for select using (public.workspace_task_visible_by_id(task_id));
drop policy if exists workspace_lb_sugg_write on public.workspace_load_balance_suggestions;
create policy workspace_lb_sugg_write on public.workspace_load_balance_suggestions
  for all
  using (public.workspace_can_write_page(workspace_id, 'tasks') and public.workspace_task_visible_by_id(task_id))
  with check (public.workspace_can_write_page(workspace_id, 'tasks') and public.workspace_task_visible_by_id(task_id));

-- ── Member settings: your own row; others only through the safe directory below ───────────────
drop policy if exists workspace_member_settings_select on public.workspace_member_settings;
create policy workspace_member_settings_select on public.workspace_member_settings
  for select using (user_id = auth.uid() or public.can_manage_workspace(workspace_id));

create or replace function public.list_workspace_member_profiles(p_workspace_id uuid)
returns table (
  user_id uuid,
  department_id uuid,
  skills text[],
  availability jsonb,
  display_name_override text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, s.department_id, s.skills, s.availability, s.display_name_override, s.avatar_url
  from public.workspace_member_settings s
  join public.workspace_members m on m.workspace_id = s.workspace_id and m.user_id = s.user_id
  where s.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id);
$$;

revoke all on function public.list_workspace_member_profiles(uuid) from public, anon;
grant execute on function public.list_workspace_member_profiles(uuid) to authenticated;

-- Directory: emails only for owners/admins (and your own); others get a name to display.
create or replace function public.list_workspace_member_directory(p_workspace_id uuid)
returns table (
  user_id uuid,
  role public.workspace_role,
  joined_at timestamptz,
  display_name text,
  avatar_url text,
  email text,
  display_name_override text,
  last_active_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    m.user_id,
    m.role,
    m.joined_at,
    coalesce(
      nullif(trim(p.display_name), ''),
      case when public.can_manage_workspace(p_workspace_id) or m.user_id = auth.uid() then null
        else split_part(u.email::text, '@', 1) end
    ),
    p.avatar_url,
    case when public.can_manage_workspace(p_workspace_id) or m.user_id = auth.uid() then u.email::text end,
    s.display_name_override,
    (
      select max(a.created_at)
      from public.workspace_activity_events a
      where a.workspace_id = p_workspace_id
        and a.actor_id = m.user_id
    ) as last_active_at
  from public.workspace_members m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join public.workspace_member_settings s
    on s.workspace_id = m.workspace_id
   and s.user_id = m.user_id
  where m.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
  order by m.joined_at;
$$;

revoke all on function public.list_workspace_member_directory(uuid) from public, anon;
grant execute on function public.list_workspace_member_directory(uuid) to authenticated;

-- ── CRM: managers only; credentials live encrypted in Supabase Vault ──────────────────────────
drop policy if exists workspace_crm_select on public.workspace_crm_integrations;
create policy workspace_crm_select on public.workspace_crm_integrations
  for select using (public.can_manage_workspace(workspace_id));

-- Clients may no longer write the credential column directly; crm_set_credentials does.
revoke insert, update on public.workspace_crm_integrations from authenticated, anon;
grant insert (workspace_id, provider, status, display_name, sync_settings, last_sync_at, last_error, created_by)
  on public.workspace_crm_integrations to authenticated;
grant update (status, display_name, sync_settings, last_sync_at, last_error)
  on public.workspace_crm_integrations to authenticated;

create or replace function public.crm_set_credentials(p_integration_id uuid, p_credentials text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_row public.workspace_crm_integrations%rowtype;
  v_secret_id uuid;
begin
  select * into v_row from public.workspace_crm_integrations where id = p_integration_id for update;
  if not found or not public.can_manage_workspace(v_row.workspace_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_row.credentials_encrypted like 'vault:%' then
    v_secret_id := public.try_uuid(substr(v_row.credentials_encrypted, 7));
  end if;
  if p_credentials is null or length(p_credentials) = 0 then
    if v_secret_id is not null then
      delete from vault.secrets where id = v_secret_id;
    end if;
    update public.workspace_crm_integrations set credentials_encrypted = null where id = p_integration_id;
    return;
  end if;
  if length(p_credentials) > 20000 then
    raise exception 'credentials_too_large';
  end if;
  if v_secret_id is not null and exists (select 1 from vault.secrets where id = v_secret_id) then
    perform vault.update_secret(v_secret_id, p_credentials);
  else
    v_secret_id := vault.create_secret(p_credentials, 'crm:' || p_integration_id::text, 'Hilm CRM integration credentials');
  end if;
  update public.workspace_crm_integrations
  set credentials_encrypted = 'vault:' || v_secret_id::text
  where id = p_integration_id;
end;
$$;

revoke all on function public.crm_set_credentials(uuid, text) from public, anon;
grant execute on function public.crm_set_credentials(uuid, text) to authenticated;

-- Decryption is for trusted server code (direct database role) only.
create or replace function private.crm_credentials(p_integration_id uuid)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select d.decrypted_secret
  from public.workspace_crm_integrations i
  join vault.decrypted_secrets d on d.id = public.try_uuid(substr(i.credentials_encrypted, 7))
  where i.id = p_integration_id and i.credentials_encrypted like 'vault:%';
$$;

revoke all on function private.crm_credentials(uuid) from public, anon, authenticated;

create or replace function private.crm_drop_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if old.credentials_encrypted like 'vault:%'
     and (tg_op = 'DELETE' or new.credentials_encrypted is distinct from old.credentials_encrypted) then
    delete from vault.secrets where id = public.try_uuid(substr(old.credentials_encrypted, 7));
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists workspace_crm_drop_secret on public.workspace_crm_integrations;
create trigger workspace_crm_drop_secret
  after update or delete on public.workspace_crm_integrations
  for each row execute function private.crm_drop_vault_secret();

-- Move any base64 credentials written by the old client into Vault.
do $$
declare
  r record;
  v_plain text;
  v_secret uuid;
begin
  for r in select id, credentials_encrypted from public.workspace_crm_integrations
           where credentials_encrypted is not null and credentials_encrypted not like 'vault:%' loop
    begin
      v_plain := convert_from(decode(r.credentials_encrypted, 'base64'), 'UTF8');
    exception when others then
      v_plain := r.credentials_encrypted;
    end;
    v_secret := vault.create_secret(v_plain, 'crm:' || r.id::text, 'Hilm CRM integration credentials');
    update public.workspace_crm_integrations set credentials_encrypted = 'vault:' || v_secret::text where id = r.id;
  end loop;
end $$;

-- True on INSERT, or when an UPDATE changes the column: unchanged references are not re-validated
-- (a departing member's assignment must not block unrelated updates such as account deletion).
create or replace function public.ref_changed(p_new jsonb, p_old jsonb, p_column text)
returns boolean
language sql
immutable
as $$
  select p_old is null or (p_new -> p_column) is distinct from (p_old -> p_column);
$$;

-- ── Cross-workspace references ────────────────────────────────────────────────────────────────
create or replace function public.enforce_workspace_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid := new.workspace_id;
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_what text;
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id cannot change' using errcode = '23514';
  end if;

  if tg_table_name = 'workspace_tasks' then
    if public.ref_changed(v_new, v_old, 'project_id') and not exists (select 1 from workspace_projects where id = new.project_id and workspace_id = v_ws) then v_what := 'project_id';
    elsif new.department_id is not null and public.ref_changed(v_new, v_old, 'department_id') and not exists (select 1 from workspace_departments where id = new.department_id and workspace_id = v_ws) then v_what := 'department_id';
    elsif new.team_id is not null and public.ref_changed(v_new, v_old, 'team_id') and not exists (select 1 from workspace_teams where id = new.team_id and workspace_id = v_ws) then v_what := 'team_id';
    elsif new.assignee_id is not null and public.ref_changed(v_new, v_old, 'assignee_id') and not exists (select 1 from workspace_members where workspace_id = v_ws and user_id = new.assignee_id) then v_what := 'assignee_id';
    elsif new.source_meeting_id is not null and public.ref_changed(v_new, v_old, 'source_meeting_id') and not exists (select 1 from workspace_meetings where id = new.source_meeting_id and workspace_id = v_ws) then v_what := 'source_meeting_id';
    elsif new.source_action_item_id is not null and public.ref_changed(v_new, v_old, 'source_action_item_id') and not exists (select 1 from workspace_meeting_action_items where id = new.source_action_item_id and workspace_id = v_ws) then v_what := 'source_action_item_id';
    end if;
  elsif tg_table_name = 'workspace_projects' then
    if new.team_id is not null and public.ref_changed(v_new, v_old, 'team_id') and not exists (select 1 from workspace_teams where id = new.team_id and workspace_id = v_ws) then v_what := 'team_id'; end if;
  elsif tg_table_name = 'workspace_project_labels' then
    if public.ref_changed(v_new, v_old, 'project_id') and not exists (select 1 from workspace_projects where id = new.project_id and workspace_id = v_ws) then v_what := 'project_id';
    elsif public.ref_changed(v_new, v_old, 'label_id') and not exists (select 1 from workspace_labels where id = new.label_id and workspace_id = v_ws) then v_what := 'label_id';
    end if;
  elsif tg_table_name = 'workspace_assignment_events' then
    if public.ref_changed(v_new, v_old, 'task_id') and not exists (select 1 from workspace_tasks where id = new.task_id and workspace_id = v_ws) then v_what := 'task_id';
    elsif new.from_department_id is not null and public.ref_changed(v_new, v_old, 'from_department_id') and not exists (select 1 from workspace_departments where id = new.from_department_id and workspace_id = v_ws) then v_what := 'from_department_id';
    elsif new.to_department_id is not null and public.ref_changed(v_new, v_old, 'to_department_id') and not exists (select 1 from workspace_departments where id = new.to_department_id and workspace_id = v_ws) then v_what := 'to_department_id';
    elsif new.from_team_id is not null and public.ref_changed(v_new, v_old, 'from_team_id') and not exists (select 1 from workspace_teams where id = new.from_team_id and workspace_id = v_ws) then v_what := 'from_team_id';
    elsif new.to_team_id is not null and public.ref_changed(v_new, v_old, 'to_team_id') and not exists (select 1 from workspace_teams where id = new.to_team_id and workspace_id = v_ws) then v_what := 'to_team_id';
    end if;
  elsif tg_table_name = 'workspace_load_balance_suggestions' then
    if public.ref_changed(v_new, v_old, 'task_id') and not exists (select 1 from workspace_tasks where id = new.task_id and workspace_id = v_ws) then v_what := 'task_id';
    elsif public.ref_changed(v_new, v_old, 'run_id') and not exists (select 1 from workspace_load_balance_runs where id = new.run_id and workspace_id = v_ws) then v_what := 'run_id';
    end if;
  elsif tg_table_name = 'workspace_team_members' then
    if public.ref_changed(v_new, v_old, 'team_id') and not exists (select 1 from workspace_teams where id = new.team_id and workspace_id = v_ws) then v_what := 'team_id';
    elsif public.ref_changed(v_new, v_old, 'user_id') and not exists (select 1 from workspace_members where workspace_id = v_ws and user_id = new.user_id) then v_what := 'user_id';
    end if;
  elsif tg_table_name = 'workspace_teams' then
    if new.department_id is not null and public.ref_changed(v_new, v_old, 'department_id') and not exists (select 1 from workspace_departments where id = new.department_id and workspace_id = v_ws) then v_what := 'department_id';
    elsif new.lead_user_id is not null and public.ref_changed(v_new, v_old, 'lead_user_id') and not exists (select 1 from workspace_members where workspace_id = v_ws and user_id = new.lead_user_id) then v_what := 'lead_user_id';
    end if;
  elsif tg_table_name = 'workspace_departments' then
    if new.parent_id is not null and public.ref_changed(v_new, v_old, 'parent_id') and not exists (select 1 from workspace_departments where id = new.parent_id and workspace_id = v_ws) then v_what := 'parent_id';
    elsif new.head_user_id is not null and public.ref_changed(v_new, v_old, 'head_user_id') and not exists (select 1 from workspace_members where workspace_id = v_ws and user_id = new.head_user_id) then v_what := 'head_user_id';
    end if;
  elsif tg_table_name = 'workspace_attachments' then
    if new.entity_type = 'task' and public.ref_changed(v_new, v_old, 'entity_id') and not exists (select 1 from workspace_tasks where id = new.entity_id and workspace_id = v_ws) then v_what := 'entity_id'; end if;
  elsif tg_table_name = 'workspace_member_settings' then
    if new.department_id is not null and public.ref_changed(v_new, v_old, 'department_id') and not exists (select 1 from workspace_departments where id = new.department_id and workspace_id = v_ws) then v_what := 'department_id'; end if;
  elsif tg_table_name in ('workspace_roadmap_items', 'workspace_project_notes') then
    if public.ref_changed(v_new, v_old, 'project_id') and not exists (select 1 from workspace_projects where id = new.project_id and workspace_id = v_ws) then v_what := 'project_id'; end if;
  elsif tg_table_name in ('workspace_meeting_speakers', 'workspace_meeting_transcript_segments', 'workspace_meeting_decisions',
                          'workspace_meeting_action_items', 'workspace_meeting_translations', 'workspace_meeting_audio_segments') then
    if public.ref_changed(v_new, v_old, 'meeting_id') and not exists (select 1 from workspace_meetings where id = new.meeting_id and workspace_id = v_ws) then v_what := 'meeting_id';
    elsif tg_table_name = 'workspace_meeting_action_items'
      and (to_jsonb(new) ->> 'task_id') is not null
      and public.ref_changed(v_new, v_old, 'task_id')
      and not exists (select 1 from workspace_tasks where id = (to_jsonb(new) ->> 'task_id')::uuid and workspace_id = v_ws) then v_what := 'task_id';
    end if;
  end if;

  if v_what is not null then
    raise exception 'cross_workspace_reference: % on %', v_what, tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_tasks', 'workspace_projects', 'workspace_project_labels', 'workspace_assignment_events',
    'workspace_load_balance_suggestions', 'workspace_team_members', 'workspace_teams', 'workspace_departments',
    'workspace_attachments', 'workspace_member_settings', 'workspace_roadmap_items', 'workspace_project_notes',
    'workspace_meeting_speakers', 'workspace_meeting_transcript_segments', 'workspace_meeting_decisions',
    'workspace_meeting_action_items', 'workspace_meeting_translations', 'workspace_meeting_audio_segments'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_integrity', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.enforce_workspace_integrity()',
      t || '_integrity', t);
  end loop;
end $$;

-- Workspace chats must belong to a workspace the owner is a member of.
create or replace function public.enforce_ai_conversation_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.workspace_id is not null and not exists (
    select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = new.user_id
  ) then
    raise exception 'cross_workspace_reference: workspace_id on ai_conversations' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_conversations_workspace_guard on public.ai_conversations;
create trigger ai_conversations_workspace_guard
  before insert or update of workspace_id, user_id on public.ai_conversations
  for each row execute function public.enforce_ai_conversation_workspace();

-- ── Invite codes: slow down guessing ──────────────────────────────────────────────────────────
create table if not exists private.workspace_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists workspace_join_attempts_user_idx on private.workspace_join_attempts (user_id, attempted_at desc);
revoke all on private.workspace_join_attempts from public, anon, authenticated;

-- Returns null for an unknown code (instead of raising) so the failed attempt is recorded.
create or replace function public.join_workspace_by_invite(p_code text)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ws public.workspaces;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if (select count(*) from private.workspace_join_attempts a
      where a.user_id = uid and not a.succeeded and a.attempted_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many invite attempts. Try again in an hour.';
  end if;

  select * into ws from public.workspaces
  where invite_code = upper(trim(coalesce(p_code, '')))
  limit 1;

  if ws.id is null then
    insert into private.workspace_join_attempts (user_id, succeeded) values (uid, false);
    return null;
  end if;

  insert into private.workspace_join_attempts (user_id, succeeded) values (uid, true);

  if exists (
    select 1 from public.workspace_members
    where workspace_id = ws.id and user_id = uid
  ) then
    return ws;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws.id, uid, 'member');

  insert into public.workspace_activity_events (workspace_id, actor_id, event_type, entity_type, entity_id, summary)
  values (ws.id, uid, 'member.joined', 'member', uid, 'Member joined via invite');

  return ws;
end;
$$;

revoke all on function public.join_workspace_by_invite(text) from public, anon;
grant execute on function public.join_workspace_by_invite(text) to authenticated;

-- ── Function hardening: anonymous callers have no business with these ────────────────────────
revoke execute on function public.create_workspace(text, text, text) from public, anon;
grant execute on function public.create_workspace(text, text, text) to authenticated;
revoke execute on function public.regenerate_workspace_invite(uuid) from public, anon;
grant execute on function public.regenerate_workspace_invite(uuid) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.assign_workspace_task_number() from public, anon, authenticated;
revoke execute on function public.enforce_workspace_comment_author() from public, anon, authenticated;
revoke execute on function public.enforce_workspace_comment_mention() from public, anon, authenticated;
revoke execute on function public.enforce_workspace_integrity() from public, anon, authenticated;
revoke execute on function public.enforce_ai_conversation_workspace() from public, anon, authenticated;
revoke execute on function private.crm_drop_vault_secret() from public, anon, authenticated;
