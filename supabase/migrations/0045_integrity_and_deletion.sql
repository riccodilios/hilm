-- Data integrity, account deletion and storage lifecycle.
--
-- 1. Account deletion: created_by on workspace projects/tasks was RESTRICT (blocked deletion), and
--    created_by/uploaded_by on workspace meetings, meeting audio, attachments and saved reports was
--    CASCADE (deleting one person wiped shared workspace data). All become SET NULL.
--    Personal tasks.project_id RESTRICT becomes NO ACTION so a whole-account cascade can complete;
--    deleting a single project that still has tasks is still refused.
-- 2. Personal records may only reference the same user's projects, tasks, meetings and tags.
-- 3. Deleting a task removes its attachment metadata (there is no FK on entity_id).
-- 4. Every removed file reference is recorded in private.storage_object_deletions. Storage objects
--    cannot be deleted from SQL (storage.protect_delete); the app deletes what the user may delete
--    right away, and this queue is the hand-off for anything else (cascades, admin terminations).
--    No retention period or scheduled purge is introduced here.
-- 5. Personal reminders are claimed atomically, so overlapping runs cannot send twice.
-- 6. The pg_cron reminder job (pointing at the retired hillm.netlify.app host, answered 403 every
--    minute) is removed; the Netlify schedule is the only trigger.

-- ── 1. Foreign keys ───────────────────────────────────────────────────────────────────────────
alter table public.workspace_projects alter column created_by drop not null;
alter table public.workspace_projects drop constraint if exists workspace_projects_created_by_fkey;
alter table public.workspace_projects add constraint workspace_projects_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.workspace_tasks alter column created_by drop not null;
alter table public.workspace_tasks drop constraint if exists workspace_tasks_created_by_fkey;
alter table public.workspace_tasks add constraint workspace_tasks_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.workspace_meetings alter column created_by drop not null;
alter table public.workspace_meetings drop constraint if exists workspace_meetings_created_by_fkey;
alter table public.workspace_meetings add constraint workspace_meetings_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.workspace_meeting_audio_segments alter column uploaded_by drop not null;
alter table public.workspace_meeting_audio_segments drop constraint if exists workspace_meeting_audio_segments_uploaded_by_fkey;
alter table public.workspace_meeting_audio_segments add constraint workspace_meeting_audio_segments_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users (id) on delete set null;

alter table public.workspace_attachments alter column uploaded_by drop not null;
alter table public.workspace_attachments drop constraint if exists workspace_attachments_uploaded_by_fkey;
alter table public.workspace_attachments add constraint workspace_attachments_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users (id) on delete set null;

alter table public.workspace_ai_reports alter column created_by drop not null;
alter table public.workspace_ai_reports drop constraint if exists workspace_ai_reports_created_by_fkey;
alter table public.workspace_ai_reports add constraint workspace_ai_reports_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

alter table public.tasks drop constraint if exists tasks_project_id_fkey;
alter table public.tasks add constraint tasks_project_id_fkey
  foreign key (project_id) references public.projects (id) on delete no action;

-- ── 2. Personal ownership ─────────────────────────────────────────────────────────────────────
create or replace function public.enforce_personal_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_new jsonb := v_row;
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_user uuid := new.user_id;
  v_what text;
  v_id uuid;
begin
  if tg_table_name = 'tasks' then
    if public.ref_changed(v_new, v_old, 'project_id') and not exists (select 1 from projects where id = new.project_id and user_id = v_user) then v_what := 'project_id';
    elsif (v_row ->> 'source_meeting_id') is not null and public.ref_changed(v_new, v_old, 'source_meeting_id')
      and not exists (select 1 from meetings where id = (v_row ->> 'source_meeting_id')::uuid and user_id = v_user) then v_what := 'source_meeting_id';
    elsif (v_row ->> 'source_action_item_id') is not null and public.ref_changed(v_new, v_old, 'source_action_item_id')
      and not exists (select 1 from meeting_action_items where id = (v_row ->> 'source_action_item_id')::uuid and user_id = v_user) then v_what := 'source_action_item_id';
    end if;
  elsif tg_table_name = 'subtasks' then
    if public.ref_changed(v_new, v_old, 'task_id') and not exists (select 1 from tasks where id = new.task_id and user_id = v_user) then v_what := 'task_id'; end if;
  elsif tg_table_name = 'task_dependencies' then
    if public.ref_changed(v_new, v_old, 'task_id') and not exists (select 1 from tasks where id = new.task_id and user_id = v_user) then v_what := 'task_id';
    elsif public.ref_changed(v_new, v_old, 'depends_on_task_id') and not exists (select 1 from tasks where id = (v_row ->> 'depends_on_task_id')::uuid and user_id = v_user) then v_what := 'depends_on_task_id';
    end if;
  elsif tg_table_name = 'task_reminders' then
    if public.ref_changed(v_new, v_old, 'task_id') and not exists (select 1 from tasks where id = new.task_id and user_id = v_user) then v_what := 'task_id';
    elsif public.ref_changed(v_new, v_old, 'project_id') and not exists (select 1 from projects where id = (v_row ->> 'project_id')::uuid and user_id = v_user) then v_what := 'project_id';
    end if;
  elsif tg_table_name in ('notes', 'ideas', 'documents', 'roadmap_items', 'releases', 'activity_events', 'ai_conversations') then
    v_id := (v_row ->> 'project_id')::uuid;
    if v_id is not null and public.ref_changed(v_new, v_old, 'project_id') and not exists (select 1 from projects where id = v_id and user_id = v_user) then v_what := 'project_id'; end if;
  elsif tg_table_name = 'attachments' then
    if new.entity_type = 'task' and public.ref_changed(v_new, v_old, 'entity_id') and not exists (select 1 from tasks where id = (v_row ->> 'entity_id')::uuid and user_id = v_user) then v_what := 'entity_id'; end if;
  elsif tg_table_name = 'entity_tags' then
    if public.ref_changed(v_new, v_old, 'tag_id') and not exists (select 1 from tags where id = (v_row ->> 'tag_id')::uuid and user_id = v_user) then v_what := 'tag_id'; end if;
  elsif tg_table_name in ('meeting_speakers', 'meeting_transcript_segments', 'meeting_decisions', 'meeting_action_items', 'meeting_audio_segments') then
    if public.ref_changed(v_new, v_old, 'meeting_id') and not exists (select 1 from meetings where id = (v_row ->> 'meeting_id')::uuid and user_id = v_user) then v_what := 'meeting_id';
    elsif tg_table_name = 'meeting_action_items' and (v_row ->> 'task_id') is not null and public.ref_changed(v_new, v_old, 'task_id')
      and not exists (select 1 from tasks where id = (v_row ->> 'task_id')::uuid and user_id = v_user) then v_what := 'task_id';
    end if;
  end if;

  if v_what is not null then
    raise exception 'cross_user_reference: % on %', v_what, tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_personal_integrity() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks', 'subtasks', 'task_dependencies', 'task_reminders', 'notes', 'ideas', 'documents', 'roadmap_items',
    'releases', 'activity_events', 'ai_conversations', 'attachments', 'entity_tags', 'meeting_speakers',
    'meeting_transcript_segments', 'meeting_decisions', 'meeting_action_items', 'meeting_audio_segments'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_owner_integrity', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.enforce_personal_integrity()',
      t || '_owner_integrity', t);
  end loop;
end $$;

-- ── 3 + 4. Attachment metadata follows its task; removed files are recorded ───────────────────
create table if not exists private.storage_object_deletions (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  object_name text not null,
  reason text not null,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  processed_at timestamptz,
  unique (bucket_id, object_name)
);
create index if not exists storage_object_deletions_pending_idx
  on private.storage_object_deletions (requested_at) where processed_at is null;
revoke all on private.storage_object_deletions from public, anon, authenticated;

create or replace function private.queue_storage_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_bucket text := case when tg_table_name in ('meeting_audio_segments', 'workspace_meeting_audio_segments')
    then 'meeting-audio' else 'attachments' end;
begin
  if old.storage_path is not null and length(old.storage_path) > 0 then
    insert into private.storage_object_deletions (bucket_id, object_name, reason)
    values (v_bucket, old.storage_path, tg_table_name || ' deleted')
    on conflict (bucket_id, object_name) do update
      set requested_at = now(), processed_at = null, reason = excluded.reason;
  end if;
  return old;
end;
$$;

revoke execute on function private.queue_storage_deletion() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['attachments', 'workspace_attachments', 'meeting_audio_segments', 'workspace_meeting_audio_segments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_queue_storage_deletion', t);
    execute format(
      'create trigger %I after delete on public.%I for each row execute function private.queue_storage_deletion()',
      t || '_queue_storage_deletion', t);
  end loop;
end $$;

create or replace function private.delete_task_attachments()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_table_name = 'workspace_tasks' then
    delete from public.workspace_attachments
    where workspace_id = old.workspace_id and entity_type = 'task' and entity_id = old.id;
  else
    delete from public.attachments
    where user_id = old.user_id and entity_type = 'task' and entity_id = old.id;
  end if;
  return old;
end;
$$;

revoke execute on function private.delete_task_attachments() from public, anon, authenticated;

drop trigger if exists tasks_delete_attachments on public.tasks;
create trigger tasks_delete_attachments
  after delete on public.tasks
  for each row execute function private.delete_task_attachments();

drop trigger if exists workspace_tasks_delete_attachments on public.workspace_tasks;
create trigger workspace_tasks_delete_attachments
  after delete on public.workspace_tasks
  for each row execute function private.delete_task_attachments();

-- Attachment rows already orphaned by earlier task deletions.
with gone as (
  delete from public.attachments a
  where a.entity_type = 'task' and not exists (select 1 from public.tasks t where t.id = a.entity_id)
  returning 1
), gone_ws as (
  delete from public.workspace_attachments a
  where a.entity_type = 'task' and not exists (select 1 from public.workspace_tasks t where t.id = a.entity_id)
  returning 1
)
select (select count(*) from gone) + (select count(*) from gone_ws);

-- ── 5. Reminder claims ────────────────────────────────────────────────────────────────────────
alter table public.task_reminders add column if not exists claimed_at timestamptz;
create index if not exists task_reminders_due_unsent_idx
  on public.task_reminders (remind_at) where notification_sent = false;

-- ── 6. Retired pg_cron trigger ────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'hilm-send-task-reminders') then
    perform cron.unschedule('hilm-send-task-reminders');
  end if;
end $$;
