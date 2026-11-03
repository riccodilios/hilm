-- Transfer a personal project into a workspace.
--
-- transfer_project_to_workspace moves every row in one transaction (project, labels, tasks with
-- checklists and pending reminders, meetings with transcripts/speakers/decisions/action items/
-- translations/audio, attachments, roadmap, notes, activity history) and deletes the personal copy.
-- Stored files keep their personal object keys at first so nothing is lost if a copy fails; the
-- caller (netlify/functions/project-transfer.ts) copies each object to its workspace key with the
-- user's own token, then finalize_project_transfer switches the rows to the new keys and queues the
-- old objects for deletion. Until then the files stay readable by the transferring user.

alter table public.workspace_roadmap_items add column if not exists starts_at date;
alter table public.workspace_roadmap_items add column if not exists ends_at date;

create table if not exists private.project_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_name text not null,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create table if not exists private.project_transfer_files (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references private.project_transfers (id) on delete cascade,
  kind text not null check (kind in ('attachment', 'audio')),
  bucket text not null,
  row_id uuid not null,
  old_file_id uuid,
  new_file_id uuid,
  old_key text not null,
  new_key text not null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  updated_at timestamptz not null default now()
);

create index if not exists project_transfer_files_transfer_idx on private.project_transfer_files (transfer_id, status);

revoke all on private.project_transfers, private.project_transfer_files from public, anon, authenticated;

create or replace function private.transfer_phrase(p_text text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g'))
$$;

create or replace function private.can_receive_project(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.can_edit_workspace_content(p_workspace_id), false)
     and coalesce(public.workspace_can_write_page(p_workspace_id, 'projects'), false)
     and coalesce(public.workspace_can_write_page(p_workspace_id, 'tasks'), false)
$$;

revoke all on function private.transfer_phrase(text) from public, anon, authenticated;
revoke all on function private.can_receive_project(uuid) from public, anon, authenticated;

-- Workspaces the caller may move a personal project into.
create or replace function public.project_transfer_targets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'color', w.color, 'logo_url', w.logo_url)
                            order by w.name), '[]'::jsonb)
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id and m.user_id = auth.uid()
  where private.can_receive_project(w.id)
$$;

create or replace function public.transfer_project_to_workspace(
  p_project_id uuid,
  p_workspace_id uuid,
  p_confirmation text
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.projects%rowtype;
  v_transfer uuid;
  v_user_prefix text;
  v_ws_prefix text;
  v_now timestamptz := now();
  v_meetings uuid[];
  v_tasks uuid[];
  v_quota bigint;
  v_used bigint;
  v_moving bigint;
  v_counts jsonb;
  v_files jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_project from public.projects where id = p_project_id and user_id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_workspace_id is null or not private.can_receive_project(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if private.transfer_phrase(p_confirmation) <> private.transfer_phrase('transfer ' || v_project.name || ' to workspace os') then
    return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch');
  end if;
  if exists (select 1 from public.workspace_projects where id = p_project_id) then
    return jsonb_build_object('ok', false, 'code', 'already_transferred');
  end if;

  select coalesce(array_agg(id), '{}') into v_meetings from public.meetings where project_id = p_project_id and user_id = v_uid;
  select coalesce(array_agg(id), '{}') into v_tasks from public.tasks where project_id = p_project_id and user_id = v_uid;

  if exists (
    select 1 from public.meetings
    where id = any(v_meetings)
      and (status in ('recording', 'processing')
           or stt_state in ('pending', 'soniox_processing', 'gemini_fallback', 'gemini_processing'))
  ) then
    return jsonb_build_object('ok', false, 'code', 'meeting_in_progress');
  end if;

  -- Stored files count toward the workspace's storage from now on.
  select coalesce(sum(f.size_bytes), 0) into v_moving
  from public.storage_files f
  where f.status = 'active'
    and f.id in (
      select file_id from public.attachments where entity_type = 'task' and entity_id = any(v_tasks) and user_id = v_uid
      union all
      select file_id from public.meeting_audio_segments where meeting_id = any(v_meetings) and user_id = v_uid
    );
  if v_moving > 0 then
    select q.quota_bytes, q.used_bytes into v_quota, v_used from private.storage_quota_for('workspace', p_workspace_id, null) q;
    if v_quota is not null and v_used + v_moving > v_quota then
      return jsonb_build_object('ok', false, 'code', 'storage_quota_exceeded');
    end if;
  end if;

  v_user_prefix := v_uid::text || '/';
  v_ws_prefix := 'workspace/' || p_workspace_id::text || '/';

  insert into private.project_transfers (user_id, project_id, workspace_id, project_name)
  values (v_uid, p_project_id, p_workspace_id, v_project.name)
  returning id into v_transfer;

  -- Project and labels.
  insert into public.workspace_projects (id, workspace_id, created_by, name, description, icon, color, status, priority,
    completion_pct, health, health_explanation, created_at, updated_at)
  values (v_project.id, p_workspace_id, v_uid, v_project.name, v_project.description, v_project.icon, v_project.color,
    v_project.status, v_project.priority, v_project.completion_pct, v_project.health, v_project.health_explanation,
    v_project.created_at, v_project.updated_at);

  insert into public.workspace_labels (workspace_id, name, color)
  select distinct on (t.name) p_workspace_id, t.name, t.color
  from public.entity_tags et join public.tags t on t.id = et.tag_id
  where et.user_id = v_uid and et.entity_type = 'project' and et.entity_id = p_project_id
  on conflict (workspace_id, name) do nothing;

  insert into public.workspace_project_labels (workspace_id, project_id, label_id)
  select p_workspace_id, p_project_id, l.id
  from public.entity_tags et
  join public.tags t on t.id = et.tag_id
  join public.workspace_labels l on l.workspace_id = p_workspace_id and l.name = t.name
  where et.user_id = v_uid and et.entity_type = 'project' and et.entity_id = p_project_id
  on conflict (project_id, label_id) do nothing;

  -- Meetings and everything under them. Share links keep working (lookup covers both tables).
  perform set_config('hilm.meeting_share_rpc', '1', true);
  insert into public.workspace_meetings (id, workspace_id, project_id, created_by, title, description, notes, held_at, status,
    started_at, ended_at, duration_seconds, language, participants, summary, key_points, processing_stage, processing_error,
    processing_attempts, expected_segments, analysis_model, analyzed_at, created_at, updated_at, analysis_input_hash,
    stt_provider, stt_state, stt_model, stt_job_id, stt_file_id, stt_audio_hash, stt_audio_ms, stt_usage_event_id,
    stt_fallback, stt_error, stt_started_at, stt_upload_claimed_at, stt_submitted_at, stt_checked_at, stt_completed_at,
    stt_webhook_token_hash, stt_webhook_status, stt_webhook_at, stt_window, stt_window_count, analysis_progress,
    share_token_hash, share_enabled_at, share_enabled_by)
  select id, p_workspace_id, p_project_id, v_uid, title, description, notes, held_at, status,
    started_at, ended_at, duration_seconds, language, participants, summary, key_points, processing_stage, processing_error,
    processing_attempts, expected_segments, analysis_model, analyzed_at, created_at, updated_at, analysis_input_hash,
    stt_provider, stt_state, stt_model, stt_job_id, stt_file_id, stt_audio_hash, stt_audio_ms, stt_usage_event_id,
    stt_fallback, stt_error, stt_started_at, stt_upload_claimed_at, stt_submitted_at, stt_checked_at, stt_completed_at,
    stt_webhook_token_hash, stt_webhook_status, stt_webhook_at, stt_window, stt_window_count, analysis_progress,
    share_token_hash, share_enabled_at, share_enabled_by
  from public.meetings where id = any(v_meetings);
  perform set_config('hilm.meeting_share_rpc', '', true);

  insert into public.workspace_meeting_speakers (id, workspace_id, meeting_id, label, display_name, description, ordinal, created_at)
  select id, p_workspace_id, meeting_id, label, display_name, description, ordinal, created_at
  from public.meeting_speakers where meeting_id = any(v_meetings);

  -- file_id is carried over, so the storage link trigger leaves the registry row alone.
  insert into public.workspace_meeting_audio_segments (id, workspace_id, meeting_id, uploaded_by, idx, storage_path, duration_ms,
    offset_ms, mime, byte_size, status, attempts, error, transcribed_at, created_at, updated_at, content_hash, file_id, audio_deleted_at)
  select id, p_workspace_id, meeting_id, v_uid, idx, storage_path, duration_ms,
    offset_ms, mime, byte_size, status, attempts, error, transcribed_at, created_at, updated_at, content_hash, file_id, audio_deleted_at
  from public.meeting_audio_segments where meeting_id = any(v_meetings);

  insert into public.workspace_meeting_transcript_segments (id, workspace_id, meeting_id, audio_segment_id, speaker_id, ordinal,
    start_ms, end_ms, text, language, created_at, languages)
  select id, p_workspace_id, meeting_id, audio_segment_id, speaker_id, ordinal, start_ms, end_ms, text, language, created_at, languages
  from public.meeting_transcript_segments where meeting_id = any(v_meetings);

  insert into public.workspace_meeting_decisions (id, workspace_id, meeting_id, text, certainty, source_segment_ids, ordinal, created_at)
  select id, p_workspace_id, meeting_id, text, certainty, source_segment_ids, ordinal, created_at
  from public.meeting_decisions where meeting_id = any(v_meetings);

  insert into public.workspace_meeting_action_items (id, workspace_id, meeting_id, title, description, owner_speaker_id,
    owner_certainty, due_text, due_date, priority, certainty, source_segment_ids, ordinal, task_id, created_at, updated_at)
  select id, p_workspace_id, meeting_id, title, description, owner_speaker_id,
    owner_certainty, due_text, due_date, priority, certainty, source_segment_ids, ordinal, null, created_at, updated_at
  from public.meeting_action_items where meeting_id = any(v_meetings);

  insert into public.workspace_meeting_translations (id, workspace_id, meeting_id, target_language, entries, model, created_at, updated_at)
  select id, p_workspace_id, meeting_id, target_language, entries, model, created_at, updated_at
  from public.meeting_translations where meeting_id = any(v_meetings);

  -- Tasks: assigned to the person moving them (personal tasks are theirs). Subtasks have no
  -- workspace equivalent, so they become a checklist in the description. Only a reminder that is
  -- still due in the future carries over.
  insert into public.workspace_tasks (id, workspace_id, project_id, created_by, assignee_id, title, description, priority, status,
    estimated_hours, due_at, due_date, position, completed_at, created_at, updated_at, reminder_type, reminder_at,
    source_meeting_id, source_action_item_id)
  select t.id, p_workspace_id, p_project_id, v_uid, v_uid, t.title,
    nullif(concat_ws(E'\n\n', nullif(btrim(coalesce(t.description, '')), ''), checklist.body,
      case when t.actual_hours is not null then 'Actual hours: ' || t.actual_hours::text end), ''),
    t.priority, t.status, t.estimated_hours, t.due_at, t.due_date, t.position, t.completed_at, t.created_at, t.updated_at,
    case when reminder.at is not null then t.reminder_type end, reminder.at,
    case when t.source_meeting_id = any(v_meetings) then t.source_meeting_id end,
    case when exists (select 1 from public.meeting_action_items a where a.id = t.source_action_item_id and a.meeting_id = any(v_meetings))
      then t.source_action_item_id end
  from public.tasks t
  left join lateral (
    select 'Checklist:' || E'\n' || string_agg(case when s.done then '- [x] ' else '- [ ] ' end || s.title, E'\n' order by s.position, s.created_at) as body
    from public.subtasks s where s.task_id = t.id
    having count(*) > 0
  ) checklist on true
  left join lateral (
    select least(
      (select min(r.remind_at) from public.task_reminders r where r.task_id = t.id and not r.notification_sent and r.remind_at > v_now),
      case when not t.notification_sent and coalesce(t.reminder_datetime, t.reminder_at) > v_now
        then coalesce(t.reminder_datetime, t.reminder_at) end
    ) as at
    where t.status not in ('done', 'archived')
  ) reminder on true
  where t.id = any(v_tasks)
  order by t.created_at, t.id;

  update public.workspace_meeting_action_items w
  set task_id = a.task_id
  from public.meeting_action_items a
  where w.id = a.id and a.meeting_id = any(v_meetings) and a.task_id = any(v_tasks);

  insert into public.workspace_attachments (id, workspace_id, entity_type, entity_id, storage_path, mime, filename, byte_size,
    version, uploaded_by, created_at, file_id)
  select id, p_workspace_id, 'task', entity_id, storage_path, mime, filename, byte_size, version, v_uid, created_at, file_id
  from public.attachments where entity_type = 'task' and entity_id = any(v_tasks) and user_id = v_uid;

  -- Roadmap and notes. Documents, ideas and releases have no workspace equivalent and become notes.
  insert into public.workspace_roadmap_items (id, workspace_id, project_id, created_by, title, description, horizon, position,
    starts_at, ends_at, created_at, updated_at)
  select id, p_workspace_id, p_project_id, v_uid, left(title, 300), left(description, 5000), horizon, position,
    starts_at, ends_at, created_at, updated_at
  from public.roadmap_items where project_id = p_project_id and user_id = v_uid;

  insert into public.workspace_project_notes (id, workspace_id, project_id, created_by, updated_by, title, body, created_at, updated_at)
  select id, p_workspace_id, p_project_id, v_uid, v_uid, left(title, 300), left(body, 200000), created_at, updated_at
  from public.notes where project_id = p_project_id and user_id = v_uid
  union all
  select id, p_workspace_id, p_project_id, v_uid, v_uid, left(title, 300), left(body, 200000), created_at, updated_at
  from public.documents where project_id = p_project_id and user_id = v_uid
  union all
  select id, p_workspace_id, p_project_id, v_uid, v_uid, left('Idea: ' || title, 300),
    left(concat_ws(E'\n\n', nullif(btrim(coalesce(description, '')), ''),
      format('Impact %s/5 · Effort %s/5 · Priority %s · Status %s', impact, effort, priority, status)), 200000),
    created_at, updated_at
  from public.ideas where project_id = p_project_id and user_id = v_uid
  union all
  select id, p_workspace_id, p_project_id, v_uid, v_uid, left('Release ' || version, 300),
    left(concat_ws(E'\n\n', nullif(btrim(coalesce(notes, '')), ''),
      case when shipped_at is not null then 'Shipped ' || to_char(shipped_at at time zone 'utc', 'YYYY-MM-DD') end), 200000),
    created_at, created_at
  from public.releases where project_id = p_project_id and user_id = v_uid;

  -- Activity history (completed roadmap steps feed the roadmap report).
  insert into public.workspace_activity_events (workspace_id, actor_id, event_type, entity_type, entity_id, summary, payload, created_at)
  select p_workspace_id, v_uid,
    case when entity_type = 'roadmap_item' then 'roadmap.' || action else entity_type || '.' || action end,
    entity_type, entity_id, summary,
    coalesce(metadata, '{}'::jsonb) || jsonb_build_object('projectId', p_project_id, 'transferred', true),
    created_at
  from public.activity_events
  where project_id = p_project_id and user_id = v_uid and action <> 'reminder_sent';

  -- Registry rows of stored files now belong to the workspace.
  update public.storage_files f
  set scope = 'workspace', workspace_id = p_workspace_id
  where f.status <> 'deleted'
    and f.id in (
      select file_id from public.attachments where entity_type = 'task' and entity_id = any(v_tasks) and user_id = v_uid
      union all
      select file_id from public.meeting_audio_segments where meeting_id = any(v_meetings) and user_id = v_uid
    );

  -- Objects still present get a workspace key reserved; the caller copies them, then finalizes.
  with live as (
    select 'attachment'::text as kind, 'attachments'::text as bucket, a.id as row_id, a.file_id, a.storage_path as old_key,
      f.size_bytes, f.mime_type, f.original_filename, a.entity_id, 'task'::text as entity_type, 'task_attachment'::text as category
    from public.attachments a
    join public.storage_files f on f.id = a.file_id and f.status = 'active'
    join storage.objects o on o.bucket_id = 'attachments' and o.name = a.storage_path
    where a.entity_type = 'task' and a.entity_id = any(v_tasks) and a.user_id = v_uid and a.storage_path like v_user_prefix || '%'
    union all
    select 'audio', 'meeting-audio', s.id, s.file_id, s.storage_path,
      f.size_bytes, f.mime_type, null, s.meeting_id, 'meeting', 'meeting_audio'
    from public.meeting_audio_segments s
    join public.storage_files f on f.id = s.file_id and f.status = 'active'
    join storage.objects o on o.bucket_id = 'meeting-audio' and o.name = s.storage_path
    where s.meeting_id = any(v_meetings) and s.user_id = v_uid and s.audio_deleted_at is null and s.storage_path like v_user_prefix || '%'
  ), reserved as (
    insert into public.storage_files (bucket, object_key, category, scope, original_filename, mime_type, declared_size_bytes,
      owner_user_id, workspace_id, entity_type, entity_id, status, upload_expires_at)
    select bucket, v_ws_prefix || substr(old_key, length(v_user_prefix) + 1), category, 'workspace', original_filename, mime_type,
      size_bytes, v_uid, p_workspace_id, entity_type, entity_id, 'pending', v_now + interval '2 hours'
    from live
    returning id, bucket, object_key
  )
  insert into private.project_transfer_files (transfer_id, kind, bucket, row_id, old_file_id, new_file_id, old_key, new_key)
  select v_transfer, live.kind, live.bucket, live.row_id, live.file_id, reserved.id, live.old_key, reserved.object_key
  from live
  join reserved on reserved.bucket = live.bucket
               and reserved.object_key = v_ws_prefix || substr(live.old_key, length(v_user_prefix) + 1);

  -- Notification links follow the project.
  update public.notifications
  set href = regexp_replace(href, '^/(personal|app)/', '/workspace/' || p_workspace_id::text || '/')
  where user_id = v_uid
    and (href like '/personal/projects/' || p_project_id::text || '%'
         or (entity_id = any(v_tasks) and (href like '/personal/tasks/%' or href like '/app/tasks/%')));

  v_counts := jsonb_build_object(
    'tasks', cardinality(v_tasks),
    'meetings', cardinality(v_meetings),
    'roadmap', (select count(*) from public.roadmap_items where project_id = p_project_id and user_id = v_uid),
    'notes', (select count(*) from public.workspace_project_notes where project_id = p_project_id),
    'files', (select count(*) from private.project_transfer_files where transfer_id = v_transfer)
  );
  update private.project_transfers set counts = v_counts where id = v_transfer;

  insert into public.workspace_activity_events (workspace_id, actor_id, event_type, entity_type, entity_id, summary, payload)
  values (p_workspace_id, v_uid, 'project.transferred', 'project', p_project_id,
    format('Project “%s” moved in from Personal OS', v_project.name), v_counts || jsonb_build_object('projectId', p_project_id));

  -- Remove the personal copy. Emptying the object keys first keeps the delete triggers from
  -- queueing the still-referenced objects for deletion.
  update public.meeting_audio_segments set storage_path = '' where meeting_id = any(v_meetings);
  update public.attachments set storage_path = '' where entity_type = 'task' and entity_id = any(v_tasks) and user_id = v_uid;
  delete from public.attachments where entity_type = 'task' and entity_id = any(v_tasks) and user_id = v_uid;
  delete from public.entity_tags where user_id = v_uid and entity_id = p_project_id and entity_type = 'project';
  delete from public.entity_tags where user_id = v_uid and entity_type = 'task' and entity_id = any(v_tasks);
  delete from public.notes where project_id = p_project_id and user_id = v_uid;
  delete from public.documents where project_id = p_project_id and user_id = v_uid;
  delete from public.ideas where project_id = p_project_id and user_id = v_uid;
  delete from public.tasks where id = any(v_tasks);
  delete from public.meetings where id = any(v_meetings);
  delete from public.projects where id = p_project_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'bucket', bucket, 'from', old_key, 'to', new_key)), '[]'::jsonb)
  into v_files
  from private.project_transfer_files where transfer_id = v_transfer;

  return jsonb_build_object('ok', true, 'transfer_id', v_transfer, 'workspace_id', p_workspace_id,
    'project_id', p_project_id, 'counts', v_counts, 'files', v_files);
end;
$$;

-- Switches copied files to their workspace keys. Safe to call repeatedly.
create or replace function public.finalize_project_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_file private.project_transfer_files%rowtype;
  v_size bigint;
  v_mime text;
  v_done integer := 0;
  v_pending jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from private.project_transfers where id = p_transfer_id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  for v_file in
    select * from private.project_transfer_files where transfer_id = p_transfer_id and status = 'pending' for update
  loop
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into v_size, v_mime
    from storage.objects o where o.bucket_id = v_file.bucket and o.name = v_file.new_key;
    if v_size is null then
      continue;
    end if;

    update public.storage_files
    set status = 'active', size_bytes = v_size, mime_type = coalesce(v_mime, mime_type), activated_at = now(), upload_expires_at = null
    where id = v_file.new_file_id and status = 'pending';

    if v_file.kind = 'attachment' then
      update public.workspace_attachments set storage_path = v_file.new_key, file_id = v_file.new_file_id
      where id = v_file.row_id and storage_path = v_file.old_key;
    else
      update public.workspace_meeting_audio_segments set storage_path = v_file.new_key, file_id = v_file.new_file_id
      where id = v_file.row_id and storage_path = v_file.old_key;
    end if;

    update public.storage_files
    set status = 'deleting', deletion_reason = 'project_transferred', deletion_requested_at = now()
    where id = v_file.old_file_id and status not in ('deleted', 'deleting');
    insert into private.storage_object_deletions (bucket_id, object_name, reason, file_id, status, next_attempt_at)
    values (v_file.bucket, v_file.old_key, 'project_transferred', v_file.old_file_id, 'pending', now())
    on conflict (bucket_id, object_name) do update
      set requested_at = now(), processed_at = null, reason = excluded.reason, status = 'pending',
          attempts = 0, next_attempt_at = now(), failed_at = null,
          file_id = coalesce(excluded.file_id, private.storage_object_deletions.file_id);

    update private.project_transfer_files set status = 'done', updated_at = now() where id = v_file.id;
    v_done := v_done + 1;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'bucket', bucket, 'from', old_key, 'to', new_key)), '[]'::jsonb)
  into v_pending
  from private.project_transfer_files where transfer_id = p_transfer_id and status = 'pending';

  if v_pending = '[]'::jsonb then
    update private.project_transfers set finalized_at = coalesce(finalized_at, now()) where id = p_transfer_id;
  end if;

  return jsonb_build_object('ok', true, 'finalized', v_done, 'pending', v_pending);
end;
$$;

revoke all on function public.project_transfer_targets() from public, anon;
revoke all on function public.transfer_project_to_workspace(uuid, uuid, text) from public, anon;
revoke all on function public.finalize_project_transfer(uuid) from public, anon;
grant execute on function public.project_transfer_targets() to authenticated;
grant execute on function public.transfer_project_to_workspace(uuid, uuid, text) to authenticated;
grant execute on function public.finalize_project_transfer(uuid) to authenticated;
