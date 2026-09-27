-- Project Meetings / AI Meeting Intelligence.
-- Personal OS and Workspace OS stay isolated via separate tables, RLS and storage paths.
-- Audio lives in the private `meeting-audio` bucket; Postgres stores metadata only.

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_value is null or p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p_value::uuid;
end;
$$;

-- ── Personal meetings (extend legacy table) ─────────────────────────────────
alter table public.meetings
  add column if not exists description text,
  add column if not exists status text not null default 'draft',
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists duration_seconds integer not null default 0,
  add column if not exists language text,
  add column if not exists participants text[] not null default '{}',
  add column if not exists summary text,
  add column if not exists key_points jsonb not null default '[]'::jsonb,
  add column if not exists processing_stage text,
  add column if not exists processing_error text,
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists expected_segments integer,
  add column if not exists analysis_model text,
  add column if not exists analyzed_at timestamptz;

-- Legacy rows (manual notes) become ready meetings with their notes as summary.
update public.meetings
set status = 'ready', summary = coalesce(summary, notes)
where status = 'draft' and notes is not null and started_at is null;

do $$ begin
  alter table public.meetings
    add constraint meetings_status_check
    check (status in ('draft', 'recording', 'processing', 'ready', 'failed'));
exception when duplicate_object then null;
end $$;

-- Meetings belong to a project; deleting the project removes its meetings.
alter table public.meetings drop constraint if exists meetings_project_id_fkey;
alter table public.meetings
  add constraint meetings_project_id_fkey
  foreign key (project_id) references public.projects (id) on delete cascade;

do $$ begin
  alter table public.meetings
    add constraint meetings_project_required check (project_id is not null) not valid;
exception when duplicate_object then null;
end $$;

create index if not exists meetings_project_created_idx
  on public.meetings (project_id, created_at desc);
create index if not exists meetings_status_idx
  on public.meetings (status) where status in ('recording', 'processing');

create table if not exists public.meeting_speakers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  label text not null,
  display_name text,
  description text,
  ordinal integer not null default 0,
  created_at timestamptz not null default now(),
  unique (meeting_id, label)
);

create table if not exists public.meeting_audio_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  idx integer not null check (idx >= 0),
  storage_path text not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  offset_ms integer not null default 0 check (offset_ms >= 0),
  mime text,
  byte_size bigint,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'transcribed', 'failed')),
  attempts integer not null default 0,
  error text,
  transcribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, idx)
);

create table if not exists public.meeting_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  audio_segment_id uuid references public.meeting_audio_segments (id) on delete cascade,
  speaker_id uuid references public.meeting_speakers (id) on delete set null,
  ordinal integer not null,
  start_ms integer not null default 0,
  end_ms integer not null default 0,
  text text not null,
  language text,
  search_tsv tsvector generated always as (to_tsvector('simple', coalesce(text, ''))) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  text text not null,
  certainty text not null default 'confirmed' check (certainty in ('confirmed', 'uncertain')),
  source_segment_ids uuid[] not null default '{}',
  ordinal integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  title text not null,
  description text,
  owner_speaker_id uuid references public.meeting_speakers (id) on delete set null,
  owner_certainty text not null default 'none' check (owner_certainty in ('confirmed', 'uncertain', 'none')),
  due_text text,
  due_date date,
  priority text check (priority in ('none', 'low', 'medium', 'high', 'urgent')),
  certainty text not null default 'confirmed' check (certainty in ('confirmed', 'possible')),
  source_segment_ids uuid[] not null default '{}',
  ordinal integer not null default 0,
  task_id uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_speakers_meeting_idx on public.meeting_speakers (meeting_id, ordinal);
create index if not exists meeting_audio_segments_meeting_idx on public.meeting_audio_segments (meeting_id, idx);
create index if not exists meeting_audio_segments_user_created_idx on public.meeting_audio_segments (user_id, created_at);
create index if not exists meeting_transcript_meeting_idx on public.meeting_transcript_segments (meeting_id, ordinal);
create index if not exists meeting_transcript_search_idx on public.meeting_transcript_segments using gin (search_tsv);
create index if not exists meeting_decisions_meeting_idx on public.meeting_decisions (meeting_id, ordinal);
create index if not exists meeting_action_items_meeting_idx on public.meeting_action_items (meeting_id, ordinal);

drop trigger if exists meeting_audio_segments_updated_at on public.meeting_audio_segments;
create trigger meeting_audio_segments_updated_at before update on public.meeting_audio_segments
  for each row execute function public.set_updated_at();
drop trigger if exists meeting_action_items_updated_at on public.meeting_action_items;
create trigger meeting_action_items_updated_at before update on public.meeting_action_items
  for each row execute function public.set_updated_at();

alter table public.meeting_speakers enable row level security;
alter table public.meeting_audio_segments enable row level security;
alter table public.meeting_transcript_segments enable row level security;
alter table public.meeting_decisions enable row level security;
alter table public.meeting_action_items enable row level security;

drop policy if exists meeting_speakers_own on public.meeting_speakers;
create policy meeting_speakers_own on public.meeting_speakers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Audio segment rows are created only through register_meeting_segment (quota enforced).
drop policy if exists meeting_audio_segments_select on public.meeting_audio_segments;
create policy meeting_audio_segments_select on public.meeting_audio_segments
  for select using (auth.uid() = user_id);
drop policy if exists meeting_audio_segments_update on public.meeting_audio_segments;
create policy meeting_audio_segments_update on public.meeting_audio_segments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists meeting_audio_segments_delete on public.meeting_audio_segments;
create policy meeting_audio_segments_delete on public.meeting_audio_segments
  for delete using (auth.uid() = user_id);

drop policy if exists meeting_transcript_own on public.meeting_transcript_segments;
create policy meeting_transcript_own on public.meeting_transcript_segments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists meeting_decisions_own on public.meeting_decisions;
create policy meeting_decisions_own on public.meeting_decisions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists meeting_action_items_own on public.meeting_action_items;
create policy meeting_action_items_own on public.meeting_action_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Task ↔ meeting traceability; unique index is the duplicate-task guarantee.
alter table public.tasks
  add column if not exists source_meeting_id uuid references public.meetings (id) on delete set null,
  add column if not exists source_action_item_id uuid references public.meeting_action_items (id) on delete set null;
create unique index if not exists tasks_source_action_item_uidx
  on public.tasks (source_action_item_id) where source_action_item_id is not null;
create index if not exists tasks_source_meeting_idx
  on public.tasks (source_meeting_id) where source_meeting_id is not null;

-- ── Workspace meetings ──────────────────────────────────────────────────────
create table if not exists public.workspace_meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.workspace_projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  notes text,
  held_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'recording', 'processing', 'ready', 'failed')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  language text,
  participants text[] not null default '{}',
  summary text,
  key_points jsonb not null default '[]'::jsonb,
  processing_stage text,
  processing_error text,
  processing_attempts integer not null default 0,
  expected_segments integer,
  analysis_model text,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_meeting_speakers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid not null references public.workspace_meetings (id) on delete cascade,
  label text not null,
  display_name text,
  description text,
  linked_user_id uuid references auth.users (id) on delete set null,
  ordinal integer not null default 0,
  created_at timestamptz not null default now(),
  unique (meeting_id, label)
);

create table if not exists public.workspace_meeting_audio_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid not null references public.workspace_meetings (id) on delete cascade,
  uploaded_by uuid not null references auth.users (id) on delete cascade,
  idx integer not null check (idx >= 0),
  storage_path text not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  offset_ms integer not null default 0 check (offset_ms >= 0),
  mime text,
  byte_size bigint,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'transcribed', 'failed')),
  attempts integer not null default 0,
  error text,
  transcribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, idx)
);

create table if not exists public.workspace_meeting_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid not null references public.workspace_meetings (id) on delete cascade,
  audio_segment_id uuid references public.workspace_meeting_audio_segments (id) on delete cascade,
  speaker_id uuid references public.workspace_meeting_speakers (id) on delete set null,
  ordinal integer not null,
  start_ms integer not null default 0,
  end_ms integer not null default 0,
  text text not null,
  language text,
  search_tsv tsvector generated always as (to_tsvector('simple', coalesce(text, ''))) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_meeting_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid not null references public.workspace_meetings (id) on delete cascade,
  text text not null,
  certainty text not null default 'confirmed' check (certainty in ('confirmed', 'uncertain')),
  source_segment_ids uuid[] not null default '{}',
  ordinal integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid not null references public.workspace_meetings (id) on delete cascade,
  title text not null,
  description text,
  owner_speaker_id uuid references public.workspace_meeting_speakers (id) on delete set null,
  owner_certainty text not null default 'none' check (owner_certainty in ('confirmed', 'uncertain', 'none')),
  due_text text,
  due_date date,
  priority text check (priority in ('none', 'low', 'medium', 'high', 'urgent')),
  certainty text not null default 'confirmed' check (certainty in ('confirmed', 'possible')),
  source_segment_ids uuid[] not null default '{}',
  ordinal integer not null default 0,
  task_id uuid references public.workspace_tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_meetings_project_idx on public.workspace_meetings (project_id, created_at desc);
create index if not exists workspace_meetings_ws_idx on public.workspace_meetings (workspace_id);
create index if not exists workspace_meetings_status_idx
  on public.workspace_meetings (status) where status in ('recording', 'processing');
create index if not exists workspace_meeting_speakers_meeting_idx on public.workspace_meeting_speakers (meeting_id, ordinal);
create index if not exists workspace_meeting_audio_meeting_idx on public.workspace_meeting_audio_segments (meeting_id, idx);
create index if not exists workspace_meeting_audio_uploader_idx on public.workspace_meeting_audio_segments (uploaded_by, created_at);
create index if not exists workspace_meeting_transcript_meeting_idx on public.workspace_meeting_transcript_segments (meeting_id, ordinal);
create index if not exists workspace_meeting_transcript_search_idx on public.workspace_meeting_transcript_segments using gin (search_tsv);
create index if not exists workspace_meeting_decisions_meeting_idx on public.workspace_meeting_decisions (meeting_id, ordinal);
create index if not exists workspace_meeting_action_items_meeting_idx on public.workspace_meeting_action_items (meeting_id, ordinal);

drop trigger if exists workspace_meetings_updated_at on public.workspace_meetings;
create trigger workspace_meetings_updated_at before update on public.workspace_meetings
  for each row execute function public.set_updated_at();
drop trigger if exists workspace_meeting_audio_updated_at on public.workspace_meeting_audio_segments;
create trigger workspace_meeting_audio_updated_at before update on public.workspace_meeting_audio_segments
  for each row execute function public.set_updated_at();
drop trigger if exists workspace_meeting_action_items_updated_at on public.workspace_meeting_action_items;
create trigger workspace_meeting_action_items_updated_at before update on public.workspace_meeting_action_items
  for each row execute function public.set_updated_at();

alter table public.workspace_meetings enable row level security;
alter table public.workspace_meeting_speakers enable row level security;
alter table public.workspace_meeting_audio_segments enable row level security;
alter table public.workspace_meeting_transcript_segments enable row level security;
alter table public.workspace_meeting_decisions enable row level security;
alter table public.workspace_meeting_action_items enable row level security;

drop policy if exists workspace_meetings_select on public.workspace_meetings;
create policy workspace_meetings_select on public.workspace_meetings
  for select using (public.is_workspace_member(workspace_id));
drop policy if exists workspace_meetings_insert on public.workspace_meetings;
create policy workspace_meetings_insert on public.workspace_meetings
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and created_by = auth.uid()
    and exists (
      select 1 from public.workspace_projects p
      where p.id = project_id and p.workspace_id = workspace_meetings.workspace_id
    )
  );
drop policy if exists workspace_meetings_update on public.workspace_meetings;
create policy workspace_meetings_update on public.workspace_meetings
  for update using (public.can_edit_workspace_content(workspace_id))
  with check (public.can_edit_workspace_content(workspace_id));
drop policy if exists workspace_meetings_delete on public.workspace_meetings;
create policy workspace_meetings_delete on public.workspace_meetings
  for delete using (created_by = auth.uid() or public.can_manage_workspace(workspace_id));

-- Child tables: members read; editors write. Audio rows are inserted via RPC only.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'workspace_meeting_speakers',
    'workspace_meeting_transcript_segments',
    'workspace_meeting_decisions',
    'workspace_meeting_action_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
    execute format(
      'create policy %I on public.%I for select using (public.is_workspace_member(workspace_id))',
      tbl || '_select', tbl
    );
    execute format('drop policy if exists %I on public.%I', tbl || '_write', tbl);
    execute format(
      'create policy %I on public.%I for all using (public.can_edit_workspace_content(workspace_id)) with check (public.can_edit_workspace_content(workspace_id))',
      tbl || '_write', tbl
    );
  end loop;
end $$;

drop policy if exists workspace_meeting_audio_select on public.workspace_meeting_audio_segments;
create policy workspace_meeting_audio_select on public.workspace_meeting_audio_segments
  for select using (public.is_workspace_member(workspace_id));
drop policy if exists workspace_meeting_audio_update on public.workspace_meeting_audio_segments;
create policy workspace_meeting_audio_update on public.workspace_meeting_audio_segments
  for update using (public.can_edit_workspace_content(workspace_id))
  with check (public.can_edit_workspace_content(workspace_id));
drop policy if exists workspace_meeting_audio_delete on public.workspace_meeting_audio_segments;
create policy workspace_meeting_audio_delete on public.workspace_meeting_audio_segments
  for delete using (public.can_edit_workspace_content(workspace_id));

alter table public.workspace_tasks
  add column if not exists source_meeting_id uuid references public.workspace_meetings (id) on delete set null,
  add column if not exists source_action_item_id uuid references public.workspace_meeting_action_items (id) on delete set null;
create unique index if not exists workspace_tasks_source_action_item_uidx
  on public.workspace_tasks (source_action_item_id) where source_action_item_id is not null;
create index if not exists workspace_tasks_source_meeting_idx
  on public.workspace_tasks (source_meeting_id) where source_meeting_id is not null;

-- ── Private audio storage ───────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-audio', 'meeting-audio', false, 20971520, array['audio/wav', 'audio/x-wav'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists meeting_audio_personal on storage.objects;
create policy meeting_audio_personal on storage.objects
  for all
  using (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists meeting_audio_workspace_select on storage.objects;
create policy meeting_audio_workspace_select on storage.objects
  for select using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = 'workspace'
    and public.is_workspace_member(public.try_uuid((storage.foldername(name))[2]))
  );
drop policy if exists meeting_audio_workspace_insert on storage.objects;
create policy meeting_audio_workspace_insert on storage.objects
  for insert with check (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = 'workspace'
    and public.can_edit_workspace_content(public.try_uuid((storage.foldername(name))[2]))
  );
drop policy if exists meeting_audio_workspace_update on storage.objects;
create policy meeting_audio_workspace_update on storage.objects
  for update using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = 'workspace'
    and public.can_edit_workspace_content(public.try_uuid((storage.foldername(name))[2]))
  );
drop policy if exists meeting_audio_workspace_delete on storage.objects;
create policy meeting_audio_workspace_delete on storage.objects
  for delete using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = 'workspace'
    and public.can_edit_workspace_content(public.try_uuid((storage.foldername(name))[2]))
  );

-- ── Cost controls (editable in-table) ───────────────────────────────────────
alter table public.ai_quota_tiers
  add column if not exists meeting_max_minutes integer not null default 60 check (meeting_max_minutes >= 0),
  add column if not exists meeting_minutes_per_month integer not null default 300 check (meeting_minutes_per_month >= 0),
  add column if not exists meeting_max_retries integer not null default 3 check (meeting_max_retries >= 0);

update public.ai_quota_tiers set meeting_max_minutes = 60, meeting_minutes_per_month = 300 where id = 'free';
update public.ai_quota_tiers set meeting_max_minutes = 180, meeting_minutes_per_month = 3000 where id = 'pro';
update public.ai_quota_tiers set meeting_max_minutes = 240, meeting_minutes_per_month = 10000 where id = 'team';

alter table public.ai_usage_events drop constraint if exists ai_usage_events_request_kind_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_request_kind_check
  check (request_kind in ('chat', 'daily_log', 'meeting_transcribe', 'meeting_analyze'));

create or replace function public.meeting_quota_status(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_tier public.ai_quota_tiers%rowtype;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_used_ms bigint;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  elsif coalesce(auth.jwt()->>'role', '') = 'service_role' and p_user_id is not null then
    v_user_id := p_user_id;
  else
    raise exception 'unauthorized';
  end if;

  select t.* into v_tier
  from public.profiles p
  join public.ai_quota_tiers t on t.id = p.ai_tier_id
  where p.id = v_user_id
  limit 1;
  if not found then
    select * into v_tier from public.ai_quota_tiers where id = 'free' limit 1;
  end if;

  select
    coalesce((select sum(duration_ms) from public.meeting_audio_segments
              where user_id = v_user_id and created_at >= v_month_start), 0)
    + coalesce((select sum(duration_ms) from public.workspace_meeting_audio_segments
                where uploaded_by = v_user_id and created_at >= v_month_start), 0)
  into v_used_ms;

  return jsonb_build_object(
    'tier', v_tier.id,
    'enabled', coalesce(v_tier.enabled, false),
    'max_minutes', v_tier.meeting_max_minutes,
    'minutes_per_month', v_tier.meeting_minutes_per_month,
    'used_minutes_month', round(v_used_ms / 60000.0, 2),
    'max_retries', v_tier.meeting_max_retries
  );
end;
$$;

-- Registers an uploaded audio segment after verifying access, path and quota.
create or replace function public.register_meeting_segment(
  p_os text,
  p_meeting_id uuid,
  p_idx integer,
  p_storage_path text,
  p_duration_ms integer,
  p_offset_ms integer,
  p_mime text default 'audio/wav',
  p_byte_size bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quota jsonb;
  v_meeting_ms bigint;
  v_existing uuid;
  v_id uuid;
  v_ws uuid;
  v_status text;
  v_duration integer := greatest(coalesce(p_duration_ms, 0), 0);
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if p_idx is null or p_idx < 0 or p_idx > 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_segment');
  end if;

  if p_os = 'personal' then
    select status into v_status from public.meetings
    where id = p_meeting_id and user_id = v_uid;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_storage_path not like (v_uid::text || '/' || p_meeting_id::text || '/%') then
      return jsonb_build_object('ok', false, 'code', 'invalid_path');
    end if;
    select id into v_existing from public.meeting_audio_segments
    where meeting_id = p_meeting_id and idx = p_idx;
    select coalesce(sum(duration_ms), 0) into v_meeting_ms
    from public.meeting_audio_segments where meeting_id = p_meeting_id;
  elsif p_os = 'workspace' then
    select status, workspace_id into v_status, v_ws from public.workspace_meetings
    where id = p_meeting_id;
    if not found or not public.can_edit_workspace_content(v_ws) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_storage_path not like ('workspace/' || v_ws::text || '/' || p_meeting_id::text || '/%') then
      return jsonb_build_object('ok', false, 'code', 'invalid_path');
    end if;
    select id into v_existing from public.workspace_meeting_audio_segments
    where meeting_id = p_meeting_id and idx = p_idx;
    select coalesce(sum(duration_ms), 0) into v_meeting_ms
    from public.workspace_meeting_audio_segments where meeting_id = p_meeting_id;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_os');
  end if;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'segment_id', v_existing, 'duplicate', true);
  end if;

  v_quota := public.meeting_quota_status(null);
  if not coalesce((v_quota->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'tier_disabled',
      'message', 'AI access is disabled for your plan.');
  end if;
  -- One minute of slack for rotation boundaries.
  if v_meeting_ms + v_duration > ((v_quota->>'max_minutes')::numeric * 60000) + 60000 then
    return jsonb_build_object('ok', false, 'code', 'meeting_too_long',
      'message', 'This meeting reached the maximum recording length for your plan.');
  end if;
  if (v_quota->>'used_minutes_month')::numeric * 60000 + v_duration
     > (v_quota->>'minutes_per_month')::numeric * 60000 then
    return jsonb_build_object('ok', false, 'code', 'monthly_meeting_limit',
      'message', 'You reached your monthly meeting minutes.');
  end if;

  if p_os = 'personal' then
    insert into public.meeting_audio_segments (
      user_id, meeting_id, idx, storage_path, duration_ms, offset_ms, mime, byte_size
    ) values (
      v_uid, p_meeting_id, p_idx, p_storage_path, v_duration,
      greatest(coalesce(p_offset_ms, 0), 0), p_mime, p_byte_size
    )
    on conflict (meeting_id, idx) do nothing
    returning id into v_id;
    if v_status = 'draft' then
      update public.meetings set status = 'recording', started_at = coalesce(started_at, now())
      where id = p_meeting_id;
    elsif v_status in ('ready', 'failed') then
      update public.meetings set status = 'processing', processing_error = null
      where id = p_meeting_id;
    end if;
  else
    insert into public.workspace_meeting_audio_segments (
      workspace_id, meeting_id, uploaded_by, idx, storage_path, duration_ms, offset_ms, mime, byte_size
    ) values (
      v_ws, p_meeting_id, v_uid, p_idx, p_storage_path, v_duration,
      greatest(coalesce(p_offset_ms, 0), 0), p_mime, p_byte_size
    )
    on conflict (meeting_id, idx) do nothing
    returning id into v_id;
    if v_status = 'draft' then
      update public.workspace_meetings set status = 'recording', started_at = coalesce(started_at, now())
      where id = p_meeting_id;
    elsif v_status in ('ready', 'failed') then
      update public.workspace_meetings set status = 'processing', processing_error = null
      where id = p_meeting_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'segment_id', v_id);
end;
$$;

grant execute on function public.try_uuid(text) to authenticated, service_role;
grant execute on function public.meeting_quota_status(uuid) to authenticated, service_role;
grant execute on function public.register_meeting_segment(text, uuid, integer, text, integer, integer, text, bigint)
  to authenticated;

-- ── begin_ai_request: meeting kinds ─────────────────────────────────────────
-- Meeting calls count toward token and cost caps but not chat request counts,
-- and use their own concurrency lane so a long meeting cannot block chat.
create or replace function public.begin_ai_request(
  p_request_kind text,
  p_model text default null,
  p_workspace_id uuid default null,
  p_conversation_id uuid default null,
  p_idempotency_key text default null,
  p_fingerprint text default null,
  p_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_tier public.ai_quota_tiers%rowtype;
  v_event public.ai_usage_events%rowtype;
  v_existing public.ai_usage_events%rowtype;
  v_lock public.ai_request_locks%rowtype;
  v_minute_count integer;
  v_day_count integer;
  v_month_count integer;
  v_day_tokens bigint;
  v_month_tokens bigint;
  v_day_cost numeric;
  v_month_cost numeric;
  v_concurrent integer;
  v_is_meeting boolean := p_request_kind in ('meeting_transcribe', 'meeting_analyze');
  v_max_concurrent integer;
  v_now timestamptz := now();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_error_code text;
  v_error_message text;
  v_fingerprint text;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
    if p_user_id is not null and p_user_id <> v_user_id then
      raise exception 'forbidden';
    end if;
  elsif coalesce(auth.jwt()->>'role', '') = 'service_role' and p_user_id is not null then
    v_user_id := p_user_id;
  else
    raise exception 'unauthorized';
  end if;

  if p_request_kind not in ('chat', 'daily_log', 'meeting_transcribe', 'meeting_analyze') then
    raise exception 'invalid_request_kind';
  end if;

  delete from public.ai_request_locks
  where user_id = v_user_id and expires_at < v_now;

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_existing
    from public.ai_usage_events
    where user_id = v_user_id
      and idempotency_key = trim(p_idempotency_key)
    limit 1;

    if found then
      if v_existing.status = 'completed' then
        return jsonb_build_object(
          'ok', false,
          'code', 'duplicate',
          'message', 'This AI request was already completed.',
          'event_id', v_existing.id,
          'status', v_existing.status
        );
      end if;
      if v_existing.status = 'started' and v_existing.created_at > v_now - interval '3 minutes' then
        return jsonb_build_object(
          'ok', false,
          'code', 'in_flight',
          'message', 'This AI request is already running. Please wait.',
          'event_id', v_existing.id,
          'status', v_existing.status
        );
      end if;
    end if;
  end if;

  v_fingerprint := nullif(trim(coalesce(p_fingerprint, '')), '');
  if v_fingerprint is not null then
    select * into v_lock
    from public.ai_request_locks
    where user_id = v_user_id
      and fingerprint = v_fingerprint
      and expires_at > v_now
    limit 1;
    if found then
      return jsonb_build_object(
        'ok', false,
        'code', 'duplicate_execution',
        'message', 'An identical AI request is already in progress.',
        'event_id', v_lock.usage_event_id
      );
    end if;
  end if;

  select t.* into v_tier
  from public.profiles p
  join public.ai_quota_tiers t on t.id = p.ai_tier_id
  where p.id = v_user_id
  limit 1;

  if not found then
    select * into v_tier from public.ai_quota_tiers where id = 'free' limit 1;
  end if;

  if not coalesce(v_tier.enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'tier_disabled',
      'message', 'AI access is disabled for your plan. Contact support.'
    );
  end if;

  select count(*) into v_minute_count
  from public.ai_usage_events
  where user_id = v_user_id
    and request_kind in ('chat', 'daily_log')
    and status in ('started', 'completed')
    and created_at > v_now - interval '1 minute';

  select count(*) into v_day_count
  from public.ai_usage_events
  where user_id = v_user_id
    and request_kind in ('chat', 'daily_log')
    and status in ('started', 'completed')
    and created_at >= v_day_start;

  select count(*) into v_month_count
  from public.ai_usage_events
  where user_id = v_user_id
    and request_kind in ('chat', 'daily_log')
    and status in ('started', 'completed')
    and created_at >= v_month_start;

  select
    coalesce(sum(total_tokens), 0),
    coalesce(sum(estimated_cost_usd), 0)
  into v_day_tokens, v_day_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
    and created_at >= v_day_start;

  select
    coalesce(sum(total_tokens), 0),
    coalesce(sum(estimated_cost_usd), 0)
  into v_month_tokens, v_month_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
    and created_at >= v_month_start;

  select count(*) into v_concurrent
  from public.ai_request_locks l
  left join public.ai_usage_events e on e.id = l.usage_event_id
  where l.user_id = v_user_id
    and l.expires_at > v_now
    and (
      (v_is_meeting and e.request_kind in ('meeting_transcribe', 'meeting_analyze'))
      or (not v_is_meeting and coalesce(e.request_kind, 'chat') in ('chat', 'daily_log'))
    );
  v_max_concurrent := case when v_is_meeting then greatest(v_tier.max_concurrent, 2) else v_tier.max_concurrent end;

  if not v_is_meeting and v_minute_count >= v_tier.requests_per_minute then
    v_error_code := 'rate_limited';
    v_error_message := 'You are sending AI requests too quickly. Please wait a moment and try again.';
  elsif not v_is_meeting and v_day_count >= v_tier.requests_per_day then
    v_error_code := 'daily_request_limit';
    v_error_message := 'You have reached your daily AI request limit. It resets at midnight UTC.';
  elsif not v_is_meeting and v_month_count >= v_tier.requests_per_month then
    v_error_code := 'monthly_request_limit';
    v_error_message := 'You have reached your monthly AI request limit.';
  elsif v_day_tokens >= v_tier.tokens_per_day then
    v_error_code := 'daily_token_limit';
    v_error_message := 'You have reached your daily AI token quota.';
  elsif v_month_tokens >= v_tier.tokens_per_month then
    v_error_code := 'monthly_token_limit';
    v_error_message := 'You have reached your monthly AI token quota.';
  elsif v_day_cost >= v_tier.cost_usd_per_day then
    v_error_code := 'daily_cost_limit';
    v_error_message := 'You have reached your daily AI spend limit.';
  elsif v_month_cost >= v_tier.cost_usd_per_month then
    v_error_code := 'monthly_cost_limit';
    v_error_message := 'You have reached your monthly AI spend limit.';
  elsif v_concurrent >= v_max_concurrent then
    v_error_code := 'concurrent_limit';
    v_error_message := 'Another AI request is already running. Please wait for it to finish.';
  end if;

  if v_error_code is not null then
    insert into public.ai_usage_events (
      user_id, workspace_id, request_kind, model, status,
      error_code, error_message, idempotency_key, conversation_id, completed_at
    ) values (
      v_user_id, p_workspace_id, p_request_kind, p_model, 'rejected',
      v_error_code, v_error_message, nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_conversation_id, v_now
    )
    returning * into v_event;

    return jsonb_build_object(
      'ok', false,
      'code', v_error_code,
      'message', v_error_message,
      'event_id', v_event.id,
      'tier', v_tier.id,
      'usage', jsonb_build_object(
        'requests_minute', v_minute_count,
        'requests_day', v_day_count,
        'requests_month', v_month_count,
        'tokens_day', v_day_tokens,
        'tokens_month', v_month_tokens,
        'cost_day', v_day_cost,
        'cost_month', v_month_cost,
        'concurrent', v_concurrent
      ),
      'limits', jsonb_build_object(
        'requests_per_minute', v_tier.requests_per_minute,
        'requests_per_day', v_tier.requests_per_day,
        'requests_per_month', v_tier.requests_per_month,
        'tokens_per_day', v_tier.tokens_per_day,
        'tokens_per_month', v_tier.tokens_per_month,
        'cost_usd_per_day', v_tier.cost_usd_per_day,
        'cost_usd_per_month', v_tier.cost_usd_per_month,
        'max_concurrent', v_tier.max_concurrent
      )
    );
  end if;

  begin
    insert into public.ai_usage_events (
      user_id, workspace_id, request_kind, model, status,
      idempotency_key, conversation_id
    ) values (
      v_user_id, p_workspace_id, p_request_kind, p_model, 'started',
      nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_conversation_id
    )
    returning * into v_event;
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'code', 'duplicate',
        'message', 'This AI request was already submitted.',
        'status', 'duplicate'
      );
  end;

  if v_fingerprint is not null then
    begin
      insert into public.ai_request_locks (user_id, fingerprint, usage_event_id, expires_at)
      values (v_user_id, v_fingerprint, v_event.id, v_now + interval '3 minutes');
    exception
      when unique_violation then
        update public.ai_usage_events
        set status = 'rejected',
            error_code = 'duplicate_execution',
            error_message = 'An identical AI request is already in progress.',
            completed_at = v_now
        where id = v_event.id;
        return jsonb_build_object(
          'ok', false,
          'code', 'duplicate_execution',
          'message', 'An identical AI request is already in progress.',
          'event_id', v_event.id
        );
    end;
  else
    insert into public.ai_request_locks (user_id, fingerprint, usage_event_id, expires_at)
    values (
      v_user_id,
      'event:' || v_event.id::text,
      v_event.id,
      v_now + interval '3 minutes'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'tier', v_tier.id,
    'usage', jsonb_build_object(
      'requests_minute', v_minute_count,
      'requests_day', v_day_count,
      'requests_month', v_month_count,
      'tokens_day', v_day_tokens,
      'tokens_month', v_month_tokens,
      'cost_day', v_day_cost,
      'cost_month', v_month_cost,
      'concurrent', v_concurrent
    ),
    'limits', jsonb_build_object(
      'requests_per_minute', v_tier.requests_per_minute,
      'requests_per_day', v_tier.requests_per_day,
      'requests_per_month', v_tier.requests_per_month,
      'tokens_per_day', v_tier.tokens_per_day,
      'tokens_per_month', v_tier.tokens_per_month,
      'cost_usd_per_day', v_tier.cost_usd_per_day,
      'cost_usd_per_month', v_tier.cost_usd_per_month,
      'max_concurrent', v_tier.max_concurrent
    )
  );
end;
$$;

grant execute on function public.begin_ai_request(text, text, uuid, uuid, text, text, uuid) to authenticated, service_role;

-- Meeting audio pricing (Gemini audio input billed per token by OpenRouter).
insert into public.ai_model_pricing (model, input_usd_per_1m, output_usd_per_1m) values
  ('google/gemini-2.5-flash:audio', 1.00, 2.50)
on conflict (model) do nothing;
