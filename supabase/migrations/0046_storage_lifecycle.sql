-- Storage registry, retention, quotas, lifecycle and infrastructure monitoring.
--
-- * public.storage_files is the single registry of stored objects (any provider). Feature tables keep
--   their own rows and reference it through file_id. File bytes never live in Postgres.
-- * Uploads of task attachments go through storage_begin_upload / storage_complete_upload: the server
--   authorizes the target, enforces size, type and quota, generates the object key, and verifies the
--   stored object before the file becomes visible. Storage policies refuse uploads without a pending
--   registry row and refuse downloads of files that are not active.
-- * Retention: platform default 90 days for task attachments; per-user and per-workspace settings;
--   platform-admin organization overrides; legal holds always win. Expired files are quarantined
--   (no access) for quarantine_days, then deleted through the existing private.storage_object_deletions
--   queue, which the scheduled worker drains with retries.
-- * Meeting audio is deleted once the meeting is ready, every segment is transcribed and the transcript
--   exists. Transcripts, summaries and translations are untouched.
-- * private.ops_* tables hold collected metrics, provider limits, alert rules and alert history.
-- Organization = workspace in Hilm (organization_id mirrors workspace_id).

-- ── Settings ──────────────────────────────────────────────────────────────────────────────────
create table if not exists private.storage_lifecycle_settings (
  id boolean primary key default true check (id),
  mode text not null default 'dry_run' check (mode in ('off', 'dry_run', 'quarantine', 'enforce')),
  quarantine_days integer not null default 14 check (quarantine_days between 1 and 365),
  abandoned_upload_hours integer not null default 24 check (abandoned_upload_hours between 1 and 720),
  orphan_grace_hours integer not null default 24 check (orphan_grace_hours between 1 and 720),
  max_deletions_per_run integer not null default 200 check (max_deletions_per_run between 1 and 5000),
  max_bytes_per_run bigint not null default 2147483648,
  circuit_breaker_files integer not null default 1000,
  max_delete_attempts integer not null default 8,
  audio_disposal_enabled boolean not null default true,
  historical_audio_cutoff timestamptz not null default now(),
  historical_audio_approved boolean not null default false,
  attachment_max_bytes bigint not null default 15728640,
  default_user_quota_bytes bigint not null default 262144000,
  default_workspace_quota_bytes bigint not null default 1073741824,
  user_max_retention_days integer not null default 365,
  workspace_max_retention_days integer not null default 730,
  lease_owner uuid,
  lease_until timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into private.storage_lifecycle_settings (id) values (true) on conflict do nothing;
revoke all on private.storage_lifecycle_settings from public, anon, authenticated;

-- ── Registry ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.storage_files (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'supabase' check (provider in ('supabase', 'r2')),
  bucket text not null,
  object_key text not null,
  category text not null check (category in ('task_attachment', 'meeting_audio', 'email_asset', 'other')),
  scope text not null check (scope in ('personal', 'workspace', 'platform')),
  original_filename text check (original_filename is null or char_length(original_filename) <= 255),
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  declared_size_bytes bigint check (declared_size_bytes is null or declared_size_bytes >= 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  owner_user_id uuid references auth.users (id) on delete set null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  organization_id uuid generated always as (workspace_id) stored,
  entity_type text,
  entity_id uuid,
  status text not null check (status in ('pending', 'active', 'quarantined', 'deleting', 'deleted', 'abandoned', 'orphaned', 'missing', 'failed')),
  upload_expires_at timestamptz,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  last_accessed_at timestamptz,
  retention_policy text,
  retention_grace_until timestamptz,
  retain_until timestamptz,
  expires_at timestamptz,
  legal_hold boolean not null default false,
  warned_7d_at timestamptz,
  warned_1d_at timestamptz,
  quarantined_at timestamptz,
  purge_after timestamptz,
  deletion_reason text,
  deletion_requested_at timestamptz,
  deletion_attempts integer not null default 0,
  last_error text,
  deleted_at timestamptz,
  previous_location jsonb,
  migrated_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists storage_files_location_uidx
  on public.storage_files (provider, bucket, object_key) where status <> 'deleted';
create index if not exists storage_files_expiry_idx on public.storage_files (expires_at) where status = 'active';
create index if not exists storage_files_status_idx on public.storage_files (status, category);
create index if not exists storage_files_purge_idx on public.storage_files (purge_after) where status in ('quarantined', 'orphaned');
create index if not exists storage_files_workspace_idx on public.storage_files (workspace_id, category) where status <> 'deleted';
create index if not exists storage_files_owner_idx on public.storage_files (owner_user_id, category) where status <> 'deleted';
create index if not exists storage_files_entity_idx on public.storage_files (entity_type, entity_id);
create index if not exists storage_files_pending_idx on public.storage_files (upload_expires_at) where status = 'pending';

alter table public.attachments add column if not exists file_id uuid references public.storage_files (id) on delete set null;
alter table public.workspace_attachments add column if not exists file_id uuid references public.storage_files (id) on delete set null;
alter table public.meeting_audio_segments add column if not exists file_id uuid references public.storage_files (id) on delete set null;
alter table public.workspace_meeting_audio_segments add column if not exists file_id uuid references public.storage_files (id) on delete set null;
alter table public.meeting_audio_segments add column if not exists audio_deleted_at timestamptz;
alter table public.workspace_meeting_audio_segments add column if not exists audio_deleted_at timestamptz;

-- ── Retention policies ────────────────────────────────────────────────────────────────────────
create table if not exists public.storage_retention_policies (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('platform', 'workspace', 'user')),
  scope_id uuid,
  category text not null check (category in ('task_attachment', 'meeting_audio')),
  retention_days integer check (retention_days is null or retention_days between 1 and 36500),
  legal_hold boolean not null default false,
  set_by text not null check (set_by in ('system', 'platform_admin', 'workspace_admin', 'user')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check ((scope_type = 'platform') = (scope_id is null))
);
create unique index if not exists storage_retention_policies_scope_uidx
  on public.storage_retention_policies (scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), category);

insert into public.storage_retention_policies (scope_type, scope_id, category, retention_days, set_by)
values ('platform', null, 'task_attachment', 90, 'system')
on conflict do nothing;

-- ── Quotas and usage counters ─────────────────────────────────────────────────────────────────
create table if not exists public.storage_quota_overrides (
  scope_type text not null check (scope_type in ('user', 'workspace')),
  scope_id uuid not null,
  max_bytes bigint not null check (max_bytes >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (scope_type, scope_id)
);

create table if not exists public.storage_usage (
  scope_type text not null check (scope_type in ('user', 'workspace')),
  scope_id uuid not null,
  category text not null,
  files_active integer not null default 0,
  bytes_active bigint not null default 0,
  bytes_pending bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope_type, scope_id, category)
);

-- ── Lifecycle runs and audit trail ────────────────────────────────────────────────────────────
create table if not exists private.storage_lifecycle_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null,
  mode text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'skipped', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists storage_lifecycle_runs_started_idx on private.storage_lifecycle_runs (started_at desc);

create table if not exists private.storage_lifecycle_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  run_id uuid,
  file_id uuid,
  action text not null,
  actor_type text not null default 'system' check (actor_type in ('system', 'user', 'admin')),
  actor_id uuid,
  bytes bigint,
  details jsonb not null default '{}'::jsonb
);
create index if not exists storage_lifecycle_events_file_idx on private.storage_lifecycle_events (file_id, occurred_at desc);
create index if not exists storage_lifecycle_events_time_idx on private.storage_lifecycle_events (occurred_at desc, action);

create or replace function private.storage_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'storage_lifecycle_events is append-only';
end;
$$;
drop trigger if exists storage_lifecycle_events_append_only on private.storage_lifecycle_events;
create trigger storage_lifecycle_events_append_only
  before update or delete on private.storage_lifecycle_events
  for each statement execute function private.storage_events_append_only();

revoke all on private.storage_lifecycle_runs, private.storage_lifecycle_events from public, anon, authenticated;

-- ── Deletion queue (from 0045): retries, terminal failures, link to the registry ─────────────
alter table private.storage_object_deletions
  add column if not exists file_id uuid,
  add column if not exists status text not null default 'pending',
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists failed_at timestamptz,
  add column if not exists provider text not null default 'supabase';
update private.storage_object_deletions set status = 'done' where processed_at is not null and status = 'pending';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'storage_object_deletions_status_check') then
    alter table private.storage_object_deletions
      add constraint storage_object_deletions_status_check check (status in ('pending', 'done', 'failed'));
  end if;
end $$;
create index if not exists storage_object_deletions_due_idx
  on private.storage_object_deletions (next_attempt_at) where status = 'pending';

-- ── Effective retention ───────────────────────────────────────────────────────────────────────
-- Precedence: file legal hold > scope legal hold > explicit file extension (retain_until, never
-- shortens) > workspace policy (platform-admin organization override or workspace admin) for
-- workspace files / user policy for personal files > platform default.
create or replace function public.storage_effective_policy(
  p_scope text, p_workspace_id uuid, p_owner_user_id uuid, p_category text
) returns table (retention_days integer, legal_hold boolean, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.storage_retention_policies%rowtype;
begin
  if p_scope = 'workspace' and p_workspace_id is not null then
    select * into v_row from public.storage_retention_policies
    where scope_type = 'workspace' and scope_id = p_workspace_id and category = p_category;
  elsif p_scope = 'personal' and p_owner_user_id is not null then
    select * into v_row from public.storage_retention_policies
    where scope_type = 'user' and scope_id = p_owner_user_id and category = p_category;
  end if;
  if found and v_row.id is not null then
    return query select v_row.retention_days, v_row.legal_hold, v_row.scope_type || ':' || v_row.set_by;
    return;
  end if;
  return query
    select p.retention_days, p.legal_hold, 'platform'::text
    from public.storage_retention_policies p
    where p.scope_type = 'platform' and p.category = p_category;
end;
$$;

create or replace function private.storage_compute_expiry(
  p_category text, p_scope text, p_workspace_id uuid, p_owner_user_id uuid,
  p_activated_at timestamptz, p_created_at timestamptz, p_retain_until timestamptz,
  p_grace_until timestamptz, p_legal_hold boolean,
  out expires_at timestamptz, out policy text
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_days integer;
  v_hold boolean;
  v_source text;
  v_base timestamptz;
begin
  if p_category <> 'task_attachment' then
    expires_at := null;
    policy := case when p_category = 'meeting_audio' then 'deleted_after_transcription' else 'none' end;
    return;
  end if;
  select e.retention_days, e.legal_hold, e.source into v_days, v_hold, v_source
  from public.storage_effective_policy(p_scope, p_workspace_id, p_owner_user_id, p_category) e;
  if coalesce(p_legal_hold, false) or coalesce(v_hold, false) then
    expires_at := null;
    policy := 'legal_hold';
    return;
  end if;
  if v_days is null then
    expires_at := null;
    policy := coalesce(v_source, 'platform') || ':keep';
    return;
  end if;
  v_base := coalesce(p_activated_at, p_created_at, now()) + make_interval(days => v_days);
  expires_at := greatest(v_base, coalesce(p_retain_until, v_base), coalesce(p_grace_until, v_base));
  policy := coalesce(v_source, 'platform') || ':' || v_days || 'd';
end;
$$;

create or replace function private.storage_files_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_exp timestamptz;
  v_policy text;
begin
  new.updated_at := now();
  if new.status = 'active' then
    select c.expires_at, c.policy into v_exp, v_policy
    from private.storage_compute_expiry(new.category, new.scope, new.workspace_id, new.owner_user_id,
      new.activated_at, new.created_at, new.retain_until, new.retention_grace_until, new.legal_hold) c;
    new.expires_at := v_exp;
    new.retention_policy := v_policy;
    -- A later expiry restarts the warning cycle.
    if new.expires_at is null or new.expires_at > now() + interval '7 days' then
      new.warned_7d_at := null;
      new.warned_1d_at := null;
    elsif new.expires_at > now() + interval '1 day' then
      new.warned_1d_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists storage_files_before_write on public.storage_files;
create trigger storage_files_before_write
  before insert or update on public.storage_files
  for each row execute function private.storage_files_before_write();

-- Usage counters follow registry changes.
create or replace function private.storage_usage_apply(
  p_scope text, p_workspace_id uuid, p_owner uuid, p_category text,
  p_files integer, p_bytes bigint, p_pending bigint
) returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_type text;
  v_id uuid;
begin
  if p_scope = 'workspace' then
    v_type := 'workspace'; v_id := p_workspace_id;
  elsif p_scope = 'personal' then
    v_type := 'user'; v_id := p_owner;
  else
    return;
  end if;
  if v_id is null or (p_files = 0 and p_bytes = 0 and p_pending = 0) then
    return;
  end if;
  insert into public.storage_usage (scope_type, scope_id, category, files_active, bytes_active, bytes_pending, updated_at)
  values (v_type, v_id, p_category, greatest(p_files, 0), greatest(p_bytes, 0), greatest(p_pending, 0), now())
  on conflict (scope_type, scope_id, category) do update set
    files_active = greatest(public.storage_usage.files_active + p_files, 0),
    bytes_active = greatest(public.storage_usage.bytes_active + p_bytes, 0),
    bytes_pending = greatest(public.storage_usage.bytes_pending + p_pending, 0),
    updated_at = now();
end;
$$;

create or replace function private.storage_files_usage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.storage_usage_apply(old.scope, old.workspace_id, old.owner_user_id, old.category,
      case when old.status = 'active' then -1 else 0 end,
      case when old.status = 'active' then -old.size_bytes else 0 end,
      case when old.status = 'pending' then -coalesce(old.declared_size_bytes, 0) else 0 end);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.storage_usage_apply(new.scope, new.workspace_id, new.owner_user_id, new.category,
      case when new.status = 'active' then 1 else 0 end,
      case when new.status = 'active' then new.size_bytes else 0 end,
      case when new.status = 'pending' then coalesce(new.declared_size_bytes, 0) else 0 end);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists storage_files_usage on public.storage_files;
create trigger storage_files_usage
  after insert or update or delete on public.storage_files
  for each row execute function private.storage_files_usage();

-- Recompute expiries when a retention policy changes.
create or replace function private.storage_policy_changed()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_type text := coalesce(new.scope_type, old.scope_type);
  v_id uuid := coalesce(new.scope_id, old.scope_id);
  v_category text := coalesce(new.category, old.category);
begin
  update public.storage_files f set updated_at = now()
  where f.status = 'active' and f.category = v_category
    and (
      v_type = 'platform'
      or (v_type = 'workspace' and f.scope = 'workspace' and f.workspace_id = v_id)
      or (v_type = 'user' and f.scope = 'personal' and f.owner_user_id = v_id)
    );
  return coalesce(new, old);
end;
$$;

drop trigger if exists storage_retention_policies_changed on public.storage_retention_policies;
create trigger storage_retention_policies_changed
  after insert or update or delete on public.storage_retention_policies
  for each row execute function private.storage_policy_changed();

-- ── Registry rows for files written through feature tables ────────────────────────────────────
create or replace function private.storage_link_feature_row()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_bucket text;
  v_category text;
  v_scope text;
  v_owner uuid;
  v_ws uuid;
  v_entity_type text;
  v_entity uuid;
  v_size bigint;
  v_mime text;
  v_id uuid;
begin
  if new.file_id is not null then
    return new;
  end if;
  if tg_table_name in ('attachments', 'workspace_attachments') then
    v_bucket := 'attachments'; v_category := 'task_attachment'; v_entity_type := v_row ->> 'entity_type';
    v_entity := (v_row ->> 'entity_id')::uuid;
  else
    v_bucket := 'meeting-audio'; v_category := 'meeting_audio'; v_entity_type := 'meeting';
    v_entity := (v_row ->> 'meeting_id')::uuid;
  end if;
  if tg_table_name in ('workspace_attachments', 'workspace_meeting_audio_segments') then
    v_scope := 'workspace'; v_ws := (v_row ->> 'workspace_id')::uuid; v_owner := (v_row ->> 'uploaded_by')::uuid;
  else
    v_scope := 'personal'; v_owner := (v_row ->> 'user_id')::uuid;
  end if;
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into v_size, v_mime
  from storage.objects o where o.bucket_id = v_bucket and o.name = new.storage_path;

  insert into public.storage_files (bucket, object_key, category, scope, original_filename, mime_type, size_bytes,
    owner_user_id, workspace_id, entity_type, entity_id, status, activated_at)
  values (v_bucket, new.storage_path, v_category, v_scope, left(v_row ->> 'filename', 255),
    coalesce(v_mime, v_row ->> 'mime'), coalesce(v_size, (v_row ->> 'byte_size')::bigint, 0),
    v_owner, v_ws, v_entity_type, v_entity, 'active', now())
  on conflict (provider, bucket, object_key) where status <> 'deleted'
  do update set size_bytes = excluded.size_bytes, mime_type = coalesce(excluded.mime_type, public.storage_files.mime_type),
    -- An object found as an orphan and registered late (an offline recorder) is adopted again.
    status = case when public.storage_files.status in ('missing', 'orphaned')
                    or (public.storage_files.status = 'deleting' and public.storage_files.deletion_reason = 'orphan_detected')
                  then 'active' else public.storage_files.status end,
    quarantined_at = case when public.storage_files.status in ('orphaned', 'deleting') then null else public.storage_files.quarantined_at end,
    purge_after = case when public.storage_files.status in ('orphaned', 'deleting') then null else public.storage_files.purge_after end,
    deletion_reason = case when public.storage_files.deletion_reason = 'orphan_detected' then null else public.storage_files.deletion_reason end,
    owner_user_id = coalesce(excluded.owner_user_id, public.storage_files.owner_user_id),
    workspace_id = coalesce(excluded.workspace_id, public.storage_files.workspace_id),
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    activated_at = coalesce(public.storage_files.activated_at, now())
  returning id into v_id;
  update private.storage_object_deletions set status = 'done', processed_at = now(), last_error = 'relinked'
  where bucket_id = v_bucket and object_name = new.storage_path and status = 'pending' and reason = 'orphan_purge';
  new.file_id := v_id;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['attachments', 'workspace_attachments', 'meeting_audio_segments', 'workspace_meeting_audio_segments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_link_storage_file', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function private.storage_link_feature_row()',
      t || '_link_storage_file', t);
  end loop;
end $$;

-- Deleting a feature row queues the object (0045) and now also marks the registry row.
create or replace function private.queue_storage_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_bucket text := case when tg_table_name in ('meeting_audio_segments', 'workspace_meeting_audio_segments')
    then 'meeting-audio' else 'attachments' end;
  v_file uuid;
begin
  if old.storage_path is not null and length(old.storage_path) > 0 then
    update public.storage_files
    set status = 'deleting',
        deletion_reason = coalesce(deletion_reason, tg_table_name || ' deleted'),
        deletion_requested_at = coalesce(deletion_requested_at, now())
    where provider = 'supabase' and bucket = v_bucket and object_key = old.storage_path
      and status not in ('deleted', 'deleting')
    returning id into v_file;
    if v_file is null then
      select id into v_file from public.storage_files
      where provider = 'supabase' and bucket = v_bucket and object_key = old.storage_path and status <> 'deleted';
    end if;
    insert into private.storage_object_deletions (bucket_id, object_name, reason, file_id, status, next_attempt_at)
    values (v_bucket, old.storage_path, tg_table_name || ' deleted', v_file, 'pending', now())
    on conflict (bucket_id, object_name) do update
      set requested_at = now(), processed_at = null, reason = excluded.reason, status = 'pending',
          attempts = 0, next_attempt_at = now(), failed_at = null,
          file_id = coalesce(excluded.file_id, private.storage_object_deletions.file_id);
  end if;
  return old;
end;
$$;
revoke execute on function private.queue_storage_deletion() from public, anon, authenticated;

-- Deleting a workspace under legal hold is refused.
create or replace function private.workspace_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.storage_retention_policies p
    where p.scope_type = 'workspace' and p.scope_id = old.id and p.legal_hold
  ) then
    raise exception 'This workspace is under a legal hold and cannot be deleted.' using errcode = '42501';
  end if;
  return old;
end;
$$;
drop trigger if exists workspaces_legal_hold_guard on public.workspaces;
create trigger workspaces_legal_hold_guard
  before delete on public.workspaces
  for each row execute function private.workspace_delete_guard();

-- ── Access helpers for Storage policies ───────────────────────────────────────────────────────
create or replace function public.storage_object_readable(p_bucket text, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.storage_files f
    where f.provider = 'supabase' and f.bucket = p_bucket and f.object_key = p_key and f.status = 'active'
  );
$$;

create or replace function public.storage_upload_allowed(p_bucket text, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.storage_files f
    where f.provider = 'supabase' and f.bucket = p_bucket and f.object_key = p_key and f.status = 'pending'
      and f.owner_user_id = auth.uid() and f.upload_expires_at > now()
  );
$$;

-- The storage worker is a dedicated service account whose id lives in private.server_secrets.
create or replace function public.is_storage_worker()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select auth.uid() is not null and exists (
    select 1 from private.server_secrets s
    where s.key = 'STORAGE_WORKER_USER_ID' and s.value = auth.uid()::text
  );
$$;

-- ── Storage policies ──────────────────────────────────────────────────────────────────────────
update storage.buckets set file_size_limit = 15728640 where id = 'attachments';

drop policy if exists attachments_storage_own on storage.objects;
drop policy if exists attachments_own_select on storage.objects;
create policy attachments_own_select on storage.objects
  for select using (
    bucket_id = 'attachments'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and public.storage_object_readable(bucket_id, name)
  );
drop policy if exists attachments_own_insert on storage.objects;
create policy attachments_own_insert on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and (auth.uid())::text = (storage.foldername(name))[1]
    and public.storage_upload_allowed(bucket_id, name)
  );
drop policy if exists attachments_own_delete on storage.objects;
create policy attachments_own_delete on storage.objects
  for delete using (
    bucket_id = 'attachments'
    and (auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists attachments_ws_select on storage.objects;
create policy attachments_ws_select on storage.objects
  for select using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'workspace'
    and public.workspace_task_visible_by_id(public.workspace_attachment_object_task(name))
    and public.storage_object_readable(bucket_id, name)
  );
drop policy if exists attachments_ws_insert on storage.objects;
create policy attachments_ws_insert on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'workspace'
    and public.workspace_attachment_object_task(name) is not null
    and public.workspace_can_write_page(public.try_uuid((storage.foldername(name))[2]), 'tasks')
    and public.workspace_task_visible_by_id(public.workspace_attachment_object_task(name))
    and public.storage_upload_allowed(bucket_id, name)
  );
-- No overwrites: a new version is a new object.
drop policy if exists attachments_ws_update on storage.objects;

drop policy if exists storage_worker_select on storage.objects;
create policy storage_worker_select on storage.objects
  for select using (bucket_id in ('attachments', 'meeting-audio') and public.is_storage_worker());
drop policy if exists storage_worker_delete on storage.objects;
create policy storage_worker_delete on storage.objects
  for delete using (bucket_id in ('attachments', 'meeting-audio') and public.is_storage_worker());

-- Attachment rows are created only by storage_complete_upload (after the object is verified) and
-- never repointed at another object; members keep delete under the existing policies.
revoke insert, update on public.attachments, public.workspace_attachments from anon, authenticated;

-- ── Registry RLS: read-only for the people who may see the parent ─────────────────────────────
alter table public.storage_files enable row level security;
drop policy if exists storage_files_select on public.storage_files;
create policy storage_files_select on public.storage_files
  for select using (
    (scope = 'personal' and owner_user_id = auth.uid())
    or (
      scope = 'workspace' and workspace_id is not null
      and case category
        when 'task_attachment' then public.workspace_task_visible_by_id(entity_id)
        when 'meeting_audio' then public.workspace_meeting_visible_by_id(entity_id)
        else public.workspace_sees_all(workspace_id)
      end
    )
  );
revoke insert, update, delete on public.storage_files from anon, authenticated;
grant select on public.storage_files to authenticated;

alter table public.storage_retention_policies enable row level security;
drop policy if exists storage_retention_policies_select on public.storage_retention_policies;
create policy storage_retention_policies_select on public.storage_retention_policies
  for select using (
    scope_type = 'platform'
    or (scope_type = 'workspace' and public.is_workspace_member(scope_id))
    or (scope_type = 'user' and scope_id = auth.uid())
  );
revoke insert, update, delete on public.storage_retention_policies from anon, authenticated;
grant select on public.storage_retention_policies to authenticated;

alter table public.storage_quota_overrides enable row level security;
drop policy if exists storage_quota_overrides_select on public.storage_quota_overrides;
create policy storage_quota_overrides_select on public.storage_quota_overrides
  for select using (
    (scope_type = 'user' and scope_id = auth.uid())
    or (scope_type = 'workspace' and public.can_manage_workspace(scope_id))
  );
revoke insert, update, delete on public.storage_quota_overrides from anon, authenticated;

alter table public.storage_usage enable row level security;
drop policy if exists storage_usage_select on public.storage_usage;
create policy storage_usage_select on public.storage_usage
  for select using (
    (scope_type = 'user' and scope_id = auth.uid())
    or (scope_type = 'workspace' and public.can_manage_workspace(scope_id))
  );
revoke insert, update, delete on public.storage_usage from anon, authenticated;

-- ── Upload contract ───────────────────────────────────────────────────────────────────────────
create or replace function private.storage_blocked_type(p_name text, p_mime text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(substring(p_name from '\.([^.]+)$'), '')) in ('svg', 'svgz', 'html', 'htm', 'xhtml', 'js', 'mjs', 'xml')
    or lower(split_part(coalesce(p_mime, ''), ';', 1)) in (
      'image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/javascript', 'application/javascript',
      'application/x-javascript', 'text/xml', 'application/xml');
$$;

create or replace function private.storage_quota_for(p_scope text, p_workspace_id uuid, p_owner uuid)
returns table (quota_bytes bigint, used_bytes bigint)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    coalesce(
      (select o.max_bytes from public.storage_quota_overrides o
       where o.scope_type = case when p_scope = 'workspace' then 'workspace' else 'user' end
         and o.scope_id = case when p_scope = 'workspace' then p_workspace_id else p_owner end),
      (select case when p_scope = 'workspace' then s.default_workspace_quota_bytes else s.default_user_quota_bytes end
       from private.storage_lifecycle_settings s)
    ),
    coalesce(
      (select sum(u.bytes_active + u.bytes_pending)::bigint from public.storage_usage u
       where u.scope_type = case when p_scope = 'workspace' then 'workspace' else 'user' end
         and u.scope_id = case when p_scope = 'workspace' then p_workspace_id else p_owner end
         and u.category = 'task_attachment'),
      0
    );
$$;

create or replace function public.storage_begin_upload(
  p_category text,
  p_entity_type text,
  p_entity_id uuid,
  p_filename text,
  p_mime text,
  p_size bigint,
  p_sha256 text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_settings private.storage_lifecycle_settings%rowtype;
  v_scope text;
  v_ws uuid;
  v_owner uuid;
  v_name text;
  v_key text;
  v_quota bigint;
  v_used bigint;
  v_id uuid;
  v_expires timestamptz := now() + interval '2 hours';
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_category is distinct from 'task_attachment' then
    return jsonb_build_object('ok', false, 'code', 'unsupported_category');
  end if;
  select * into v_settings from private.storage_lifecycle_settings;
  if p_size is null or p_size <= 0 then
    return jsonb_build_object('ok', false, 'code', 'empty_file');
  end if;
  if p_size > v_settings.attachment_max_bytes then
    return jsonb_build_object('ok', false, 'code', 'too_large', 'max_bytes', v_settings.attachment_max_bytes);
  end if;
  v_name := left(regexp_replace(coalesce(nullif(trim(p_filename), ''), 'file'), '[^A-Za-z0-9_.\-]', '_', 'g'), 180);
  if private.storage_blocked_type(v_name, p_mime) then
    return jsonb_build_object('ok', false, 'code', 'blocked_type');
  end if;
  if p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_checksum');
  end if;

  if p_entity_type = 'task' then
    if not exists (select 1 from public.tasks t where t.id = p_entity_id and t.user_id = v_uid) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    v_scope := 'personal';
    v_owner := v_uid;
    v_key := v_uid::text || '/tasks/' || p_entity_id::text || '/';
  elsif p_entity_type = 'workspace_task' then
    select t.workspace_id into v_ws from public.workspace_tasks t where t.id = p_entity_id;
    if v_ws is null
       or not public.workspace_task_visible_by_id(p_entity_id)
       or not public.workspace_can_write_page(v_ws, 'tasks') then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    v_scope := 'workspace';
    v_owner := v_uid;
    v_key := 'workspace/' || v_ws::text || '/tasks/' || p_entity_id::text || '/';
  else
    return jsonb_build_object('ok', false, 'code', 'unsupported_entity');
  end if;

  -- One decision per tenant at a time, so parallel uploads cannot overrun the quota.
  perform pg_advisory_xact_lock(hashtextextended('hilm.storage_quota:' || v_scope || ':' || coalesce(v_ws, v_owner)::text, 0));

  if (select count(*) from public.storage_files f
      where f.owner_user_id = v_uid and f.status = 'pending' and f.created_at > now() - interval '1 hour') >= 50 then
    return jsonb_build_object('ok', false, 'code', 'too_many_pending');
  end if;

  select q.quota_bytes, q.used_bytes into v_quota, v_used from private.storage_quota_for(v_scope, v_ws, v_owner) q;
  if v_used + p_size > v_quota then
    return jsonb_build_object('ok', false, 'code', 'quota_exceeded', 'quota_bytes', v_quota, 'used_bytes', v_used);
  end if;

  v_key := v_key || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || v_name;
  insert into public.storage_files (bucket, object_key, category, scope, original_filename, mime_type,
    declared_size_bytes, checksum_sha256, owner_user_id, workspace_id, entity_type, entity_id, status, upload_expires_at)
  values ('attachments', v_key, 'task_attachment', v_scope, left(coalesce(p_filename, v_name), 255),
    nullif(left(coalesce(p_mime, ''), 255), ''), p_size, p_sha256, v_owner, v_ws, 'task', p_entity_id, 'pending', v_expires)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'file_id', v_id, 'provider', 'supabase', 'bucket', 'attachments',
    'object_key', v_key, 'upload_expires_at', v_expires);
end;
$$;

create or replace function public.storage_complete_upload(p_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_file public.storage_files%rowtype;
  v_settings private.storage_lifecycle_settings%rowtype;
  v_size bigint;
  v_mime text;
  v_row jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select * into v_file from public.storage_files where id = p_file_id and owner_user_id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_file.status = 'active' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'file_id', v_file.id, 'expires_at', v_file.expires_at);
  end if;
  if v_file.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_pending', 'status', v_file.status);
  end if;
  select * into v_settings from private.storage_lifecycle_settings;
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into v_size, v_mime
  from storage.objects o where o.bucket_id = v_file.bucket and o.name = v_file.object_key;
  if v_size is null then
    return jsonb_build_object('ok', false, 'code', 'object_missing');
  end if;

  if v_size <> coalesce(v_file.declared_size_bytes, -1) or v_size > v_settings.attachment_max_bytes
     or private.storage_blocked_type(v_file.object_key, v_mime) then
    update public.storage_files
    set status = 'failed', size_bytes = v_size, mime_type = coalesce(v_mime, mime_type),
        last_error = case when private.storage_blocked_type(v_file.object_key, v_mime) then 'blocked_type'
                          when v_size > v_settings.attachment_max_bytes then 'too_large' else 'size_mismatch' end,
        deletion_reason = 'rejected_upload', deletion_requested_at = now()
    where id = v_file.id;
    insert into private.storage_object_deletions (bucket_id, object_name, reason, file_id, status, next_attempt_at)
    values (v_file.bucket, v_file.object_key, 'rejected_upload', v_file.id, 'pending', now())
    on conflict (bucket_id, object_name) do update set status = 'pending', processed_at = null, attempts = 0,
      next_attempt_at = now(), file_id = excluded.file_id, reason = excluded.reason;
    insert into private.storage_lifecycle_events (file_id, action, actor_type, actor_id, bytes, details)
    values (v_file.id, 'upload_rejected', 'user', v_uid, v_size, jsonb_build_object('declared', v_file.declared_size_bytes, 'mime', v_mime));
    return jsonb_build_object('ok', false, 'code', 'rejected', 'reason',
      case when private.storage_blocked_type(v_file.object_key, v_mime) then 'blocked_type'
           when v_size > v_settings.attachment_max_bytes then 'too_large' else 'size_mismatch' end);
  end if;

  update public.storage_files
  set status = 'active', size_bytes = v_size, mime_type = coalesce(v_mime, mime_type), activated_at = now(), upload_expires_at = null
  where id = v_file.id
  returning * into v_file;

  if v_file.scope = 'personal' then
    insert into public.attachments (user_id, entity_type, entity_id, storage_path, mime, filename, byte_size, version, file_id)
    values (v_uid, 'task', v_file.entity_id, v_file.object_key, v_file.mime_type, coalesce(v_file.original_filename, 'file'), v_size, 1, v_file.id)
    returning to_jsonb(attachments) into v_row;
  else
    insert into public.workspace_attachments (workspace_id, entity_type, entity_id, storage_path, mime, filename, byte_size, version, uploaded_by, file_id)
    values (v_file.workspace_id, 'task', v_file.entity_id, v_file.object_key, v_file.mime_type, coalesce(v_file.original_filename, 'file'), v_size, 1, v_uid, v_file.id)
    returning to_jsonb(workspace_attachments) into v_row;
  end if;

  insert into private.storage_lifecycle_events (file_id, action, actor_type, actor_id, bytes, details)
  values (v_file.id, 'uploaded', 'user', v_uid, v_size, jsonb_build_object('category', v_file.category, 'scope', v_file.scope));

  return jsonb_build_object('ok', true, 'file_id', v_file.id, 'expires_at', v_file.expires_at, 'attachment', v_row);
end;
$$;

create or replace function public.storage_cancel_upload(p_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_file public.storage_files%rowtype;
begin
  update public.storage_files set status = 'abandoned', deletion_reason = 'cancelled', deletion_requested_at = now()
  where id = p_file_id and owner_user_id = auth.uid() and status = 'pending'
  returning * into v_file;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = v_file.bucket and o.name = v_file.object_key) then
    insert into private.storage_object_deletions (bucket_id, object_name, reason, file_id, status, next_attempt_at)
    values (v_file.bucket, v_file.object_key, 'cancelled_upload', v_file.id, 'pending', now())
    on conflict (bucket_id, object_name) do update set status = 'pending', processed_at = null, attempts = 0,
      next_attempt_at = now(), file_id = excluded.file_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Retention controls ────────────────────────────────────────────────────────────────────────
create or replace function public.storage_retention_info(p_workspace_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_settings private.storage_lifecycle_settings%rowtype;
  v_days integer;
  v_hold boolean;
  v_source text;
  v_platform integer;
  v_locked boolean := false;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_workspace_id is not null and not public.is_workspace_member(p_workspace_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_settings from private.storage_lifecycle_settings;
  select retention_days into v_platform from public.storage_retention_policies
  where scope_type = 'platform' and category = 'task_attachment';
  select e.retention_days, e.legal_hold, e.source into v_days, v_hold, v_source
  from public.storage_effective_policy(
    case when p_workspace_id is null then 'personal' else 'workspace' end, p_workspace_id, auth.uid(), 'task_attachment') e;
  if p_workspace_id is not null then
    v_locked := exists (select 1 from public.storage_retention_policies
      where scope_type = 'workspace' and scope_id = p_workspace_id and set_by = 'platform_admin');
  end if;
  return jsonb_build_object(
    'retention_days', v_days,
    'legal_hold', coalesce(v_hold, false),
    'source', v_source,
    'platform_default_days', v_platform,
    'quarantine_days', v_settings.quarantine_days,
    'max_days', case when p_workspace_id is null then v_settings.user_max_retention_days else v_settings.workspace_max_retention_days end,
    'can_manage', case when p_workspace_id is null then true else public.can_manage_workspace(p_workspace_id) and not v_locked end,
    'can_extend', case when p_workspace_id is null then true else public.can_manage_workspace(p_workspace_id) end,
    'managed_by_platform', v_locked,
    'audio_policy', 'deleted_after_transcription'
  );
end;
$$;

create or replace function public.storage_set_workspace_retention(p_workspace_id uuid, p_retention_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_max integer;
begin
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.storage_retention_policies
             where scope_type = 'workspace' and scope_id = p_workspace_id and set_by = 'platform_admin') then
    return jsonb_build_object('ok', false, 'code', 'managed_by_platform');
  end if;
  select workspace_max_retention_days into v_max from private.storage_lifecycle_settings;
  if p_retention_days is null or p_retention_days < 7 or p_retention_days > v_max then
    return jsonb_build_object('ok', false, 'code', 'out_of_range', 'min', 7, 'max', v_max);
  end if;
  insert into public.storage_retention_policies (scope_type, scope_id, category, retention_days, set_by, updated_by, updated_at)
  values ('workspace', p_workspace_id, 'task_attachment', p_retention_days, 'workspace_admin', auth.uid(), now())
  on conflict (scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), category)
  do update set retention_days = excluded.retention_days, set_by = 'workspace_admin', updated_by = auth.uid(), updated_at = now();
  insert into private.storage_lifecycle_events (action, actor_type, actor_id, details)
  values ('retention_changed', 'user', auth.uid(),
    jsonb_build_object('scope', 'workspace', 'workspace_id', p_workspace_id, 'retention_days', p_retention_days));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.storage_set_my_retention(p_retention_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_max integer;
begin
  if auth.uid() is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select user_max_retention_days into v_max from private.storage_lifecycle_settings;
  if p_retention_days is null or p_retention_days < 7 or p_retention_days > v_max then
    return jsonb_build_object('ok', false, 'code', 'out_of_range', 'min', 7, 'max', v_max);
  end if;
  insert into public.storage_retention_policies (scope_type, scope_id, category, retention_days, set_by, updated_by, updated_at)
  values ('user', auth.uid(), 'task_attachment', p_retention_days, 'user', auth.uid(), now())
  on conflict (scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), category)
  do update set retention_days = excluded.retention_days, updated_by = auth.uid(), updated_at = now();
  insert into private.storage_lifecycle_events (action, actor_type, actor_id, details)
  values ('retention_changed', 'user', auth.uid(), jsonb_build_object('scope', 'personal', 'retention_days', p_retention_days));
  return jsonb_build_object('ok', true);
end;
$$;

-- Keep a file longer (owner of a personal file; owner/admin for workspace files).
create or replace function public.storage_extend_file(p_file_id uuid, p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_file public.storage_files%rowtype;
  v_settings private.storage_lifecycle_settings%rowtype;
  v_max integer;
  v_until timestamptz;
begin
  select * into v_file from public.storage_files where id = p_file_id for update;
  if not found or v_file.status <> 'active' or v_file.category <> 'task_attachment' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_settings from private.storage_lifecycle_settings;
  if v_file.scope = 'personal' then
    if v_file.owner_user_id is distinct from auth.uid() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_max := v_settings.user_max_retention_days;
  else
    if not public.can_manage_workspace(v_file.workspace_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_max := v_settings.workspace_max_retention_days;
  end if;
  if p_days is null or p_days < 1 or p_days > v_max then
    return jsonb_build_object('ok', false, 'code', 'out_of_range', 'max', v_max);
  end if;
  v_until := least(now() + make_interval(days => p_days),
                   coalesce(v_file.activated_at, v_file.created_at) + make_interval(days => v_max));
  update public.storage_files set retain_until = greatest(coalesce(retain_until, v_until), v_until)
  where id = p_file_id returning * into v_file;
  insert into private.storage_lifecycle_events (file_id, action, actor_type, actor_id, details)
  values (p_file_id, 'retention_extended', 'user', auth.uid(), jsonb_build_object('retain_until', v_file.retain_until));
  return jsonb_build_object('ok', true, 'expires_at', v_file.expires_at);
end;
$$;

-- ── Lifecycle worker steps (run by the scheduled worker on the server connection only) ────────
create or replace function private.storage_lifecycle_begin(p_trigger text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_settings private.storage_lifecycle_settings%rowtype;
  v_owner uuid := gen_random_uuid();
  v_run uuid;
begin
  update private.storage_lifecycle_settings
  set lease_owner = v_owner, lease_until = now() + interval '4 minutes'
  where id and (lease_until is null or lease_until < now())
  returning * into v_settings;
  if not found then
    return jsonb_build_object('skipped', true, 'reason', 'another_run_in_progress');
  end if;
  insert into private.storage_lifecycle_runs (trigger, mode) values (p_trigger, v_settings.mode) returning id into v_run;
  return jsonb_build_object('skipped', false, 'run_id', v_run, 'lease_owner', v_owner, 'mode', v_settings.mode,
    'max_deletions_per_run', v_settings.max_deletions_per_run, 'max_bytes_per_run', v_settings.max_bytes_per_run,
    'max_delete_attempts', v_settings.max_delete_attempts);
end;
$$;

create or replace function private.storage_lifecycle_finish(p_run uuid, p_lease uuid, p_status text, p_stats jsonb, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update private.storage_lifecycle_runs
  set status = p_status, finished_at = now(), stats = coalesce(p_stats, '{}'::jsonb), error = left(p_error, 1000)
  where id = p_run;
  update private.storage_lifecycle_settings set lease_owner = null, lease_until = null where id and lease_owner = p_lease;
end;
$$;

-- Everything except calling the storage provider: inventory, warnings, expiry, quarantine, purge
-- requests and audio disposal. Destructive steps depend on the mode; dry_run only counts.
create or replace function private.storage_lifecycle_step(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  s private.storage_lifecycle_settings%rowtype;
  v_stats jsonb := '{}'::jsonb;
  v_n integer;
  v_bytes bigint;
  v_candidates integer;
  v_destructive boolean;
  v_warn boolean;
  v_ids uuid[];
  v_personal_keys text[];
  v_workspace_keys text[];
  r record;
begin
  select * into s from private.storage_lifecycle_settings;
  if s.mode = 'off' then
    return jsonb_build_object('mode', 'off');
  end if;
  v_destructive := s.mode = 'enforce';
  v_warn := s.mode in ('quarantine', 'enforce');

  -- 1. Deletions that already happened (client removed the object, or a previous run did).
  with confirmed as (
    update public.storage_files f set status = 'deleted', deleted_at = coalesce(f.deleted_at, now())
    where f.status = 'deleting' and f.provider = 'supabase'
      and not exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = f.object_key)
    returning f.id, f.size_bytes, f.deletion_reason, f.category, f.bucket, f.object_key
  ), logged as (
    insert into private.storage_lifecycle_events (run_id, file_id, action, bytes, details)
    select p_run, c.id, 'deleted', c.size_bytes, jsonb_build_object('reason', c.deletion_reason, 'category', c.category) from confirmed c
    returning 1
  ), audio as (
    update public.meeting_audio_segments m set audio_deleted_at = coalesce(m.audio_deleted_at, now())
    from confirmed c where c.bucket = 'meeting-audio' and m.storage_path = c.object_key
    returning 1
  ), audio_ws as (
    update public.workspace_meeting_audio_segments m set audio_deleted_at = coalesce(m.audio_deleted_at, now())
    from confirmed c where c.bucket = 'meeting-audio' and m.storage_path = c.object_key
    returning 1
  ), done as (
    update private.storage_object_deletions d set status = 'done', processed_at = coalesce(d.processed_at, now())
    from confirmed c where d.bucket_id = c.bucket and d.object_name = c.object_key and d.status = 'pending'
    returning 1
  )
  select count(*), coalesce(sum(size_bytes), 0) into v_n, v_bytes from confirmed;
  v_stats := v_stats || jsonb_build_object('confirmed_deleted', v_n, 'confirmed_deleted_bytes', v_bytes);

  -- 2. Inventory (all modes, metadata only): objects nobody references, references to missing objects.
  with orphan as (
    insert into public.storage_files (bucket, object_key, category, scope, size_bytes, mime_type, owner_user_id, workspace_id,
      status, quarantined_at, purge_after, deletion_reason, created_at)
    select o.bucket_id, o.name,
      case when o.bucket_id = 'meeting-audio' then 'meeting_audio' else 'task_attachment' end,
      case when (storage.foldername(o.name))[1] = 'workspace' then 'workspace' else 'personal' end,
      coalesce((o.metadata ->> 'size')::bigint, 0), o.metadata ->> 'mimetype',
      case when (storage.foldername(o.name))[1] = 'workspace' then null
           else (select u.id from auth.users u where u.id = public.try_uuid((storage.foldername(o.name))[1])) end,
      case when (storage.foldername(o.name))[1] = 'workspace'
           then (select w.id from public.workspaces w where w.id = public.try_uuid((storage.foldername(o.name))[2])) end,
      'orphaned', now(), now() + make_interval(days => s.quarantine_days), 'orphan_detected', o.created_at
    from storage.objects o
    where o.bucket_id in ('attachments', 'meeting-audio')
      and o.created_at < now() - make_interval(hours => s.orphan_grace_hours)
      and not exists (
        select 1 from public.storage_files f
        where f.provider = 'supabase' and f.bucket = o.bucket_id and f.object_key = o.name and f.status <> 'deleted'
      )
    on conflict do nothing
    returning id, size_bytes
  ), logged as (
    insert into private.storage_lifecycle_events (run_id, file_id, action, bytes)
    select p_run, id, 'orphan_detected', size_bytes from orphan returning 1
  )
  select count(*), coalesce(sum(size_bytes), 0) into v_n, v_bytes from orphan;
  v_stats := v_stats || jsonb_build_object('orphans_detected', v_n, 'orphans_detected_bytes', v_bytes);

  with missing as (
    update public.storage_files f set status = 'missing', last_error = 'object_not_found'
    where f.status = 'active' and f.provider = 'supabase'
      and coalesce(f.activated_at, f.created_at) < now() - interval '1 hour'
      and not exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = f.object_key)
    returning f.id
  ), logged as (
    insert into private.storage_lifecycle_events (run_id, file_id, action) select p_run, id, 'missing_detected' from missing returning 1
  )
  select count(*) into v_n from missing;
  v_stats := v_stats || jsonb_build_object('missing_detected', v_n);

  -- 3. Abandoned uploads.
  select count(*) into v_n from public.storage_files
  where status = 'pending' and upload_expires_at < now() - make_interval(hours => s.abandoned_upload_hours);
  v_stats := v_stats || jsonb_build_object('abandoned_uploads', v_n);
  if v_warn then
    with abandoned as (
      update public.storage_files f set status = 'abandoned', deletion_reason = 'abandoned_upload', deletion_requested_at = now()
      where f.status = 'pending' and f.upload_expires_at < now() - make_interval(hours => s.abandoned_upload_hours)
      returning f.id, f.bucket, f.object_key
    ), queued as (
      insert into private.storage_object_deletions (bucket_id, object_name, reason, file_id, status, next_attempt_at)
      select a.bucket, a.object_key, 'abandoned_upload', a.id, 'pending', now() from abandoned a
      where exists (select 1 from storage.objects o where o.bucket_id = a.bucket and o.name = a.object_key)
      on conflict (bucket_id, object_name) do update set status = 'pending', processed_at = null, attempts = 0, next_attempt_at = now()
      returning 1
    )
    insert into private.storage_lifecycle_events (run_id, file_id, action) select p_run, id, 'upload_abandoned' from abandoned;
  end if;

  -- 4. Expiry warnings. Nobody loses a file without notice: the first warning goes out at least
  -- 7 days and the second at least 1 day before the file is quarantined, even when the expiry
  -- date itself has already passed (for example after a long dry run).
  select count(*) into v_n from public.storage_files f
  where f.status = 'active' and f.category = 'task_attachment' and not f.legal_hold
    and f.expires_at is not null and f.expires_at <= now() + interval '7 days' and f.warned_7d_at is null;
  v_stats := v_stats || jsonb_build_object('warnings_7d_due', v_n);
  if v_warn then
    for r in
      select f.*,
        case when f.warned_7d_at is null then greatest(f.expires_at, now() + interval '7 days')
             else greatest(f.expires_at, f.warned_7d_at + interval '7 days') end as removal_at
      from public.storage_files f
      where f.status = 'active' and f.category = 'task_attachment' and not f.legal_hold and f.expires_at is not null
        and ((f.warned_7d_at is null and f.expires_at <= now() + interval '7 days')
          or (f.warned_7d_at is not null and f.warned_1d_at is null
              and greatest(f.expires_at, f.warned_7d_at + interval '7 days') <= now() + interval '1 day'))
      order by f.expires_at
      limit 500
    loop
      insert into public.notifications (user_id, channel, type, title, body, entity_type, entity_id, href, metadata)
      select distinct on (recipient) recipient, 'in_app', 'storage.file_expiring',
        'Attachment expires ' || to_char(r.removal_at at time zone 'UTC', 'Mon DD'),
        '"' || coalesce(r.original_filename, 'A file') || '" will be removed on ' || to_char(r.removal_at at time zone 'UTC', 'Mon DD, YYYY')
          || ' under your retention policy. Download it or keep it longer from the task.',
        case when r.scope = 'workspace' then 'workspace_task' else 'task' end,
        r.entity_id,
        case when r.scope = 'workspace' then '/workspace/' || r.workspace_id || '/tasks/' || r.entity_id
             else '/personal/tasks/' || r.entity_id end,
        jsonb_build_object('file_id', r.id, 'expires_at', r.removal_at, 'stage', case when r.warned_7d_at is null then '7d' else '1d' end)
      from (
        select r.owner_user_id as recipient where r.owner_user_id is not null
          and (r.scope = 'personal' or exists (select 1 from public.workspace_members m where m.workspace_id = r.workspace_id and m.user_id = r.owner_user_id))
        union
        select m.user_id from public.workspace_members m
        where r.scope = 'workspace' and m.workspace_id = r.workspace_id and m.role in ('owner', 'admin')
      ) recipients;
      update public.storage_files
      set warned_7d_at = coalesce(warned_7d_at, now()),
          warned_1d_at = case when r.warned_7d_at is not null then now() else warned_1d_at end
      where id = r.id;
      insert into private.storage_lifecycle_events (run_id, file_id, action, details)
      values (p_run, r.id, case when r.warned_7d_at is null then 'expiry_warning_7d' else 'expiry_warning_1d' end,
        jsonb_build_object('removal_at', r.removal_at));
    end loop;
  end if;

  -- 5–7. Destructive candidates, guarded by a circuit breaker.
  select count(*) into v_candidates from (
    select 1 from public.storage_files f
    where f.status = 'active' and f.category = 'task_attachment' and not f.legal_hold
      and f.expires_at is not null and f.expires_at <= now()
    union all
    select 1 from public.storage_files f
    where f.status in ('quarantined', 'orphaned') and f.purge_after <= now() and not f.legal_hold
  ) c;
  v_stats := v_stats || jsonb_build_object('expired_or_purgeable', v_candidates);

  select count(*), coalesce(sum(f.size_bytes), 0) into v_n, v_bytes
  from public.storage_files f
  join lateral (
    select m.id, m.status, m.analyzed_at, m.updated_at, 'personal' as os from public.meetings m where m.id = f.entity_id
    union all
    select m.id, m.status, m.analyzed_at, m.updated_at, 'workspace' from public.workspace_meetings m where m.id = f.entity_id
  ) mt on true
  where f.category = 'meeting_audio' and f.status = 'active' and mt.status = 'ready'
    and private.storage_meeting_transcribed(mt.os, mt.id);
  v_stats := v_stats || jsonb_build_object('audio_disposable_files', v_n, 'audio_disposable_bytes', v_bytes);

  if v_candidates > s.circuit_breaker_files then
    return v_stats || jsonb_build_object('circuit_breaker', true);
  end if;

  if v_warn then
    with expired as (
      update public.storage_files f
      set status = 'quarantined', quarantined_at = now(), purge_after = now() + make_interval(days => s.quarantine_days),
          deletion_reason = 'retention_expired'
      where f.id in (
        select id from public.storage_files
        where status = 'active' and category = 'task_attachment' and not legal_hold
          and expires_at is not null and expires_at <= now()
          and warned_7d_at is not null and warned_7d_at <= now() - interval '7 days' + interval '15 minutes'
          and warned_1d_at is not null and warned_1d_at <= now() - interval '1 day' + interval '15 minutes'
        order by expires_at
        limit s.max_deletions_per_run
      )
      returning f.id, f.size_bytes
    ), logged as (
      insert into private.storage_lifecycle_events (run_id, file_id, action, bytes)
      select p_run, id, 'quarantined', size_bytes from expired returning 1
    )
    select count(*) into v_n from expired;
    v_stats := v_stats || jsonb_build_object('quarantined', v_n);
  end if;

  if v_destructive then
    -- Purge expired attachments: removing the feature row queues the object and marks the registry
    -- row (0045 trigger); rows without a feature row are queued directly.
    select array_agg(f.id), array_agg(f.object_key) filter (where f.scope = 'personal'),
           array_agg(f.object_key) filter (where f.scope = 'workspace')
      into v_ids, v_personal_keys, v_workspace_keys
    from (
      select id, scope, object_key from public.storage_files
      where status = 'quarantined' and purge_after <= now() and not legal_hold and category = 'task_attachment'
      order by purge_after
      limit s.max_deletions_per_run
    ) f;
    if v_ids is not null then
      if v_personal_keys is not null then
        delete from public.attachments where storage_path = any(v_personal_keys);
      end if;
      if v_workspace_keys is not null then
        delete from public.workspace_attachments where storage_path = any(v_workspace_keys);
      end if;
      with marked as (
        update public.storage_files f set status = 'deleting', deletion_requested_at = coalesce(f.deletion_requested_at, now())
        where f.id = any(v_ids) and f.status = 'quarantined'
        returning f.id, f.bucket, f.object_key
      )
      insert into private.storage_object_deletions (bucket_id, object_name, reason, file_id, status, next_attempt_at)
      select m.bucket, m.object_key, 'retention_expired', m.id, 'pending', now() from marked m
      on conflict (bucket_id, object_name) do update set status = 'pending', processed_at = null, attempts = 0,
        next_attempt_at = now(), file_id = excluded.file_id;
      update private.storage_object_deletions d set reason = 'retention_expired'
      from public.storage_files f where f.id = any(v_ids) and d.bucket_id = f.bucket and d.object_name = f.object_key;
      insert into private.storage_lifecycle_events (run_id, file_id, action)
      select p_run, unnest(v_ids), 'purge_requested';
    end if;
    v_stats := v_stats || jsonb_build_object('purge_requested', coalesce(cardinality(v_ids), 0));

    -- Orphaned objects past their quarantine.
    with due as (
      update public.storage_files f set status = 'deleting', deletion_requested_at = now()
      where f.id in (
        select id from public.storage_files
        where status = 'orphaned' and purge_after <= now() and not legal_hold
        order by purge_after limit s.max_deletions_per_run
      )
      returning f.id, f.bucket, f.object_key
    ), queued as (
      insert into private.storage_object_deletions (bucket_id, object_name, reason, file_id, status, next_attempt_at)
      select d.bucket, d.object_key, 'orphan_purge', d.id, 'pending', now() from due d
      on conflict (bucket_id, object_name) do update set status = 'pending', processed_at = null, attempts = 0,
        next_attempt_at = now(), file_id = excluded.file_id
      returning 1
    )
    select count(*) into v_n from due;
    v_stats := v_stats || jsonb_build_object('orphan_purge_requested', v_n);

    -- Old copies of migrated files, once the rollback period has passed.
    with expired as (
      update public.storage_files f set previous_location = null
      from (
        select id, previous_location as old from public.storage_files
        where previous_location is not null and (previous_location ->> 'rollback_until')::timestamptz <= now()
        limit s.max_deletions_per_run
      ) src
      where f.id = src.id
      returning f.id, src.old
    ), queued as (
      insert into private.storage_object_deletions (provider, bucket_id, object_name, reason, file_id, status, next_attempt_at)
      select e.old ->> 'provider', e.old ->> 'bucket', e.old ->> 'object_key', 'migration_rollback_expired', e.id, 'pending', now()
      from expired e
      on conflict (bucket_id, object_name) do update set provider = excluded.provider, reason = excluded.reason,
        file_id = excluded.file_id, status = 'pending', processed_at = null, attempts = 0, next_attempt_at = now()
      returning 1
    )
    select count(*) into v_n from queued;
    v_stats := v_stats || jsonb_build_object('previous_copies_queued', v_n);

    -- Meeting audio of finished, verified transcriptions.
    if s.audio_disposal_enabled then
      with eligible as (
        select f.id, f.bucket, f.object_key from public.storage_files f
        join lateral (
          select m.id, m.status, m.analyzed_at, m.updated_at, 'personal' as os from public.meetings m where m.id = f.entity_id
          union all
          select m.id, m.status, m.analyzed_at, m.updated_at, 'workspace' from public.workspace_meetings m where m.id = f.entity_id
        ) mt on true
        where f.category = 'meeting_audio' and f.status = 'active' and not f.legal_hold and mt.status = 'ready'
          and (s.historical_audio_approved or coalesce(mt.analyzed_at, mt.updated_at) >= s.historical_audio_cutoff)
          and private.storage_meeting_transcribed(mt.os, mt.id)
        limit s.max_deletions_per_run
      ), marked as (
        update public.storage_files f set status = 'deleting', deletion_reason = 'transcribed', deletion_requested_at = now()
        from eligible e where f.id = e.id
        returning f.id, f.bucket, f.object_key
      ), queued as (
        insert into private.storage_object_deletions (bucket_id, object_name, reason, file_id, status, next_attempt_at)
        select m.bucket, m.object_key, 'transcribed', m.id, 'pending', now() from marked m
        on conflict (bucket_id, object_name) do update set status = 'pending', processed_at = null, attempts = 0,
          next_attempt_at = now(), file_id = excluded.file_id
        returning 1
      )
      select count(*) into v_n from marked;
      v_stats := v_stats || jsonb_build_object('audio_disposal_requested', v_n);
    end if;
  end if;

  return v_stats;
end;
$$;

-- A meeting's transcription is final: the meeting is ready, the full-recording transcription
-- (stt_state) finished or never applied (meetings before Soniox), every audio segment is
-- transcribed and transcript text is saved.
create or replace function private.storage_meeting_transcribed(p_os text, p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_os = 'personal' then
    exists (select 1 from public.meetings m where m.id = p_meeting_id and m.status = 'ready'
            and (m.stt_state is null or m.stt_state = 'completed'))
    and exists (select 1 from public.meeting_audio_segments s where s.meeting_id = p_meeting_id)
    and not exists (select 1 from public.meeting_audio_segments s where s.meeting_id = p_meeting_id and s.status <> 'transcribed')
    and exists (select 1 from public.meeting_transcript_segments t where t.meeting_id = p_meeting_id and length(trim(t.text)) > 0)
  else
    exists (select 1 from public.workspace_meetings m where m.id = p_meeting_id and m.status = 'ready'
            and (m.stt_state is null or m.stt_state = 'completed'))
    and exists (select 1 from public.workspace_meeting_audio_segments s where s.meeting_id = p_meeting_id)
    and not exists (select 1 from public.workspace_meeting_audio_segments s where s.meeting_id = p_meeting_id and s.status <> 'transcribed')
    and exists (select 1 from public.workspace_meeting_transcript_segments t where t.meeting_id = p_meeting_id and length(trim(t.text)) > 0)
  end;
$$;

-- Claims queue items for this run (enforce mode only, checked by the caller), up to a count and a
-- byte budget. Claimed rows are leased for 10 minutes so a crashed run is retried, not lost.
create or replace function private.storage_claim_deletions(p_limit integer, p_max_bytes bigint)
returns table (id bigint, provider text, bucket_id text, object_name text, file_id uuid, attempts integer, size_bytes bigint)
language sql
security definer
set search_path = public, private
as $$
  with due as (
    select d.id, d.next_attempt_at, coalesce(f.size_bytes, 0) as sz
    from private.storage_object_deletions d
    left join public.storage_files f on f.id = d.file_id
    where d.status = 'pending' and d.next_attempt_at <= now()
    order by d.next_attempt_at
    limit greatest(p_limit, 0)
    for update of d skip locked
  ), capped as (
    select x.id, x.sz from (
      select due.id, due.sz, sum(due.sz) over (order by due.next_attempt_at, due.id) - due.sz as before from due
    ) x
    where x.before < p_max_bytes
  )
  update private.storage_object_deletions d
  set next_attempt_at = now() + interval '10 minutes'
  from capped where d.id = capped.id
  returning d.id, d.provider, d.bucket_id, d.object_name, d.file_id, d.attempts, capped.sz;
$$;

-- Records the provider result. Success is confirmed, never assumed: against storage.objects for
-- Supabase, and by the caller's follow-up existence check (p_absent_confirmed) for other providers.
create or replace function private.storage_record_deletion(
  p_id bigint, p_run uuid, p_provider_ok boolean, p_error text, p_absent_confirmed boolean default false)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  d private.storage_object_deletions%rowtype;
  v_max integer;
  v_present boolean;
  v_size bigint;
begin
  select * into d from private.storage_object_deletions where id = p_id for update;
  if not found or d.status <> 'pending' then
    return 'skipped';
  end if;
  select max_delete_attempts into v_max from private.storage_lifecycle_settings;
  if d.provider = 'supabase' then
    v_present := exists (select 1 from storage.objects o where o.bucket_id = d.bucket_id and o.name = d.object_name);
  else
    v_present := not coalesce(p_absent_confirmed, false);
  end if;
  if p_provider_ok and not v_present then
    update private.storage_object_deletions set status = 'done', processed_at = now(), last_error = null where id = p_id;
    -- A previous location left behind by a provider migration: the registry row stays active.
    if d.reason = 'migration_rollback_expired' then
      insert into private.storage_lifecycle_events (run_id, file_id, action, details)
      values (p_run, d.file_id, 'previous_copy_deleted', jsonb_build_object('provider', d.provider, 'bucket', d.bucket_id));
      return 'deleted';
    end if;
    update public.storage_files f set status = 'deleted', deleted_at = now(), deletion_attempts = f.deletion_attempts + 1, last_error = null
    where f.status <> 'deleted'
      and ((d.file_id is not null and f.id = d.file_id)
        or (d.file_id is null and f.provider = d.provider and f.bucket = d.bucket_id and f.object_key = d.object_name))
    returning f.size_bytes into v_size;
    update public.meeting_audio_segments set audio_deleted_at = coalesce(audio_deleted_at, now())
    where d.bucket_id = 'meeting-audio' and storage_path = d.object_name;
    update public.workspace_meeting_audio_segments set audio_deleted_at = coalesce(audio_deleted_at, now())
    where d.bucket_id = 'meeting-audio' and storage_path = d.object_name;
    insert into private.storage_lifecycle_events (run_id, file_id, action, bytes, details)
    values (p_run, d.file_id, 'deleted', v_size, jsonb_build_object('reason', d.reason, 'bucket', d.bucket_id));
    return 'deleted';
  end if;
  update private.storage_object_deletions
  set attempts = attempts + 1,
      last_error = left(coalesce(p_error, case when v_present then 'object_still_present' else 'provider_error' end), 500),
      next_attempt_at = now() + least(interval '24 hours', make_interval(mins => (5 * power(2, attempts))::integer)),
      status = case when attempts + 1 >= v_max then 'failed' else 'pending' end,
      failed_at = case when attempts + 1 >= v_max then now() else null end
  where id = p_id
  returning * into d;
  update public.storage_files f set deletion_attempts = f.deletion_attempts + 1, last_error = d.last_error,
    status = case when d.status = 'failed' and d.reason <> 'migration_rollback_expired' then 'failed' else f.status end
  where f.id = d.file_id;
  insert into private.storage_lifecycle_events (run_id, file_id, action, details)
  values (p_run, d.file_id, case when d.status = 'failed' then 'delete_failed_terminal' else 'delete_retry_scheduled' end,
    jsonb_build_object('error', d.last_error, 'attempts', d.attempts, 'next_attempt_at', d.next_attempt_at));
  return case when d.status = 'failed' then 'failed' else 'retry' end;
end;
$$;

-- Rebuilds usage counters from the registry and reports drift.
create or replace function private.storage_reconcile_usage()
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_drift integer;
begin
  with truth as (
    select case when scope = 'workspace' then 'workspace' else 'user' end as scope_type,
      case when scope = 'workspace' then workspace_id else owner_user_id end as scope_id,
      category,
      count(*) filter (where status = 'active')::integer as files_active,
      coalesce(sum(size_bytes) filter (where status = 'active'), 0)::bigint as bytes_active,
      coalesce(sum(declared_size_bytes) filter (where status = 'pending'), 0)::bigint as bytes_pending
    from public.storage_files
    where scope in ('workspace', 'personal')
      and (case when scope = 'workspace' then workspace_id else owner_user_id end) is not null
    group by 1, 2, 3
  ), diff as (
    select coalesce(t.scope_type, u.scope_type) st, coalesce(t.scope_id, u.scope_id) sid, coalesce(t.category, u.category) cat,
      coalesce(t.files_active, 0) fa, coalesce(t.bytes_active, 0) ba, coalesce(t.bytes_pending, 0) bp
    from truth t full join public.storage_usage u
      on u.scope_type = t.scope_type and u.scope_id = t.scope_id and u.category = t.category
    where u.scope_id is null or t.scope_id is null
       or u.files_active <> t.files_active or u.bytes_active <> t.bytes_active or u.bytes_pending <> t.bytes_pending
  ), fixed as (
    insert into public.storage_usage (scope_type, scope_id, category, files_active, bytes_active, bytes_pending, updated_at)
    select st, sid, cat, fa, ba, bp, now() from diff
    on conflict (scope_type, scope_id, category) do update set
      files_active = excluded.files_active, bytes_active = excluded.bytes_active, bytes_pending = excluded.bytes_pending, updated_at = now()
    returning 1
  )
  select count(*) into v_drift from fixed;
  return v_drift;
end;
$$;

-- Report for the admin and for dry-run review.
create or replace function private.storage_inventory_report()
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'by_category_status', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'status', status, 'files', n, 'bytes', b) order by category, status)
      from (select category, status, count(*) n, coalesce(sum(size_bytes), 0) b from public.storage_files group by 1, 2) x), '[]'::jsonb),
    'attachments', (
      select jsonb_build_object(
        'files', count(*) filter (where status = 'active'),
        'bytes', coalesce(sum(size_bytes) filter (where status = 'active'), 0),
        'older_than_90_days', count(*) filter (where status = 'active' and coalesce(activated_at, created_at) < now() - interval '90 days'),
        'expiring_within_7_days', count(*) filter (where status = 'active' and expires_at <= now() + interval '7 days'),
        'expired_awaiting_quarantine', count(*) filter (where status = 'active' and expires_at <= now()),
        'quarantined', count(*) filter (where status = 'quarantined'),
        'legal_hold', count(*) filter (where legal_hold or retention_policy = 'legal_hold'),
        'missing_object', count(*) filter (where status = 'missing'),
        'reclaimable_bytes', coalesce(sum(size_bytes) filter (where status in ('quarantined') or (status = 'active' and expires_at <= now())), 0)
      ) from public.storage_files where category = 'task_attachment'),
    'audio', (
      select jsonb_build_object(
        'files', count(*) filter (where f.status = 'active'),
        'bytes', coalesce(sum(f.size_bytes) filter (where f.status = 'active'), 0),
        'transcribed_files', count(*) filter (where f.status = 'active' and private.storage_meeting_transcribed(m.os, m.id)),
        'transcribed_bytes', coalesce(sum(f.size_bytes) filter (where f.status = 'active' and private.storage_meeting_transcribed(m.os, m.id)), 0),
        'deleted_bytes', coalesce(sum(f.size_bytes) filter (where f.status = 'deleted'), 0)
      ) from public.storage_files f
      left join lateral (
        select x.id, 'personal' as os from public.meetings x where x.id = f.entity_id
        union all select x.id, 'workspace' from public.workspace_meetings x where x.id = f.entity_id
      ) m on true
      where f.category = 'meeting_audio'),
    'orphans', (select jsonb_build_object('files', count(*), 'bytes', coalesce(sum(size_bytes), 0))
      from public.storage_files where status = 'orphaned'),
    'unregistered_objects', (select jsonb_build_object('files', count(*), 'bytes', coalesce(sum((o.metadata ->> 'size')::bigint), 0))
      from storage.objects o where o.bucket_id in ('attachments', 'meeting-audio')
        and not exists (select 1 from public.storage_files f where f.bucket = o.bucket_id and f.object_key = o.name and f.status <> 'deleted')),
    'queue', (select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'),
        'failed', count(*) filter (where status = 'failed'),
        'done', count(*) filter (where status = 'done'),
        'oldest_pending_hours', coalesce(extract(epoch from now() - min(requested_at) filter (where status = 'pending')) / 3600, 0))
      from private.storage_object_deletions),
    'reclaimed_bytes', (select coalesce(sum(bytes), 0) from private.storage_lifecycle_events where action = 'deleted')
  );
$$;

revoke all on function private.storage_lifecycle_begin(text), private.storage_lifecycle_finish(uuid, uuid, text, jsonb, text),
  private.storage_lifecycle_step(uuid), private.storage_claim_deletions(integer, bigint),
  private.storage_record_deletion(bigint, uuid, boolean, text, boolean), private.storage_reconcile_usage(),
  private.storage_inventory_report(), private.storage_meeting_transcribed(text, uuid),
  private.storage_compute_expiry(text, text, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, boolean),
  private.storage_quota_for(text, uuid, uuid), private.storage_usage_apply(text, uuid, uuid, text, integer, bigint, bigint),
  private.storage_blocked_type(text, text)
  from public, anon, authenticated;
revoke all on function private.storage_files_before_write(), private.storage_files_usage(), private.storage_policy_changed(),
  private.storage_link_feature_row(), private.workspace_delete_guard(), private.storage_events_append_only()
  from public, anon, authenticated;

revoke all on function public.storage_begin_upload(text, text, uuid, text, text, bigint, text),
  public.storage_complete_upload(uuid), public.storage_cancel_upload(uuid),
  public.storage_retention_info(uuid), public.storage_set_workspace_retention(uuid, integer),
  public.storage_set_my_retention(integer), public.storage_extend_file(uuid, integer),
  public.storage_effective_policy(text, uuid, uuid, text)
  from public, anon;
grant execute on function public.storage_begin_upload(text, text, uuid, text, text, bigint, text),
  public.storage_complete_upload(uuid), public.storage_cancel_upload(uuid),
  public.storage_retention_info(uuid), public.storage_set_workspace_retention(uuid, integer),
  public.storage_set_my_retention(integer), public.storage_extend_file(uuid, integer)
  to authenticated;

-- ── Infrastructure monitoring ─────────────────────────────────────────────────────────────────
create table if not exists private.ops_metric_snapshots (
  id bigint generated always as identity primary key,
  metric text not null,
  scope text not null default 'global',
  value numeric,
  unit text not null,
  source text not null,
  quality text not null check (quality in ('provider_live', 'provider_synced', 'app_calculated', 'estimated', 'manual', 'unavailable')),
  details jsonb,
  collected_at timestamptz not null default now()
);
create index if not exists ops_metric_snapshots_metric_idx on private.ops_metric_snapshots (metric, scope, collected_at desc);
create index if not exists ops_metric_snapshots_time_idx on private.ops_metric_snapshots (collected_at);

create table if not exists private.ops_limits (
  key text primary key,
  label text not null,
  limit_value numeric,
  unit text not null,
  plan text,
  quality text not null check (quality in ('provider_live', 'provider_synced', 'app_calculated', 'estimated', 'manual', 'unavailable')),
  source text not null,
  verified_at timestamptz,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists private.ops_alert_rules (
  key text primary key,
  metric text not null,
  scope text not null default 'global',
  comparison text not null default 'gte' check (comparison in ('gte', 'lte')),
  warn_value numeric,
  crit_value numeric,
  limit_key text references private.ops_limits (key) on delete set null,
  cooldown_hours integer not null default 24,
  notify boolean not null default true,
  enabled boolean not null default true,
  description text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.ops_alerts (
  id bigint generated always as identity primary key,
  rule_key text not null,
  level text not null check (level in ('warning', 'critical')),
  value numeric,
  threshold numeric,
  message text not null,
  opened_at timestamptz not null default now(),
  last_notified_at timestamptz,
  resolved_at timestamptz,
  resolution_notified_at timestamptz
);
create index if not exists ops_alerts_open_idx on private.ops_alerts (rule_key) where resolved_at is null;
create index if not exists ops_alerts_time_idx on private.ops_alerts (opened_at desc);

create table if not exists private.ops_function_daily (
  day date not null,
  fn text not null,
  invocations integer not null default 0,
  errors integer not null default 0,
  total_ms bigint not null default 0,
  max_ms integer not null default 0,
  primary key (day, fn)
);

create table if not exists private.ops_collector_state (
  collector text primary key,
  interval_minutes integer not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text
);

revoke all on private.ops_metric_snapshots, private.ops_limits, private.ops_alert_rules, private.ops_alerts,
  private.ops_function_daily, private.ops_collector_state from public, anon, authenticated;

-- Plan limits verified on 2026-10-31 (Supabase organization API: plan=free; Netlify account API:
-- legacy Free plan capabilities; published pricing pages for the rest).
insert into private.ops_limits (key, label, limit_value, unit, plan, quality, source, verified_at, notes) values
  ('supabase.db_size', 'Supabase database size', 524288000, 'bytes', 'free', 'provider_synced', 'Supabase org API plan=free; supabase.com/pricing', '2026-10-31', 'Free: 500 MB; Pro: 8 GB disk then $0.125/GB'),
  ('supabase.storage', 'Supabase Storage', 1073741824, 'bytes', 'free', 'provider_synced', 'Supabase org API plan=free; supabase.com/pricing', '2026-10-31', 'Free: 1 GB; Pro: 100 GB then $0.0213/GB'),
  ('supabase.egress', 'Supabase egress (uncached)', 5368709120, 'bytes', 'free', 'provider_synced', 'supabase.com/pricing', '2026-10-31', 'Usage not exposed by any available API; enter from the dashboard'),
  ('supabase.max_upload', 'Supabase max file size', 52428800, 'bytes', 'free', 'provider_synced', 'supabase.com/pricing', '2026-10-31', 'Pro: 500 GB'),
  ('supabase.backups_days', 'Supabase automatic backups', 0, 'days', 'free', 'provider_synced', 'supabase.com/pricing', '2026-10-31', 'Free plan has no automatic backups; Pro keeps 7 days'),
  ('netlify.function_invocations', 'Netlify function invocations / month', 125000, 'requests', 'free', 'provider_synced', 'Netlify account capabilities API', '2026-10-31', null),
  ('netlify.function_runtime', 'Netlify function runtime / month', 360000, 'seconds', 'free', 'provider_synced', 'Netlify site usage API', '2026-10-31', null),
  ('netlify.bandwidth', 'Netlify bandwidth / month', 107374182400, 'bytes', 'free', 'provider_synced', 'Netlify account capabilities API', '2026-10-31', null),
  ('netlify.build_minutes', 'Netlify build minutes / month', 300, 'minutes', 'free', 'provider_synced', 'Netlify account capabilities API', '2026-10-31', null),
  ('resend.daily_emails', 'Resend emails / day', 100, 'emails', 'free (assumed)', 'manual', 'resend.com/pricing', '2026-10-31', 'Plan not readable through the API; Free plan limits shown'),
  ('resend.monthly_emails', 'Resend emails / month', 3000, 'emails', 'free (assumed)', 'manual', 'resend.com/pricing', '2026-10-31', null),
  ('soniox.hourly_rate_usd', 'Soniox async price per audio hour', 0.10, 'usd', 'pay-as-you-go', 'manual', 'soniox.com/pricing', '2026-10-31', 'No free allowance; no usage API')
on conflict (key) do update set label = excluded.label, limit_value = excluded.limit_value, unit = excluded.unit, plan = excluded.plan,
  quality = excluded.quality, source = excluded.source, verified_at = excluded.verified_at, notes = excluded.notes, updated_at = now();

insert into private.ops_alert_rules (key, metric, comparison, warn_value, crit_value, limit_key, cooldown_hours, description) values
  ('storage_capacity', 'supabase.storage_bytes', 'gte', 70, 90, 'supabase.storage', 24, 'Supabase Storage use, % of plan'),
  ('database_capacity', 'supabase.db_size_bytes', 'gte', 70, 90, 'supabase.db_size', 24, 'Database size, % of plan'),
  ('egress_capacity', 'supabase.egress_bytes', 'gte', 70, 90, 'supabase.egress', 24, 'Supabase egress, % of plan (manual metric)'),
  ('netlify_invocations', 'netlify.function_invocations', 'gte', 70, 90, 'netlify.function_invocations', 24, 'Netlify function invocations this month, % of plan'),
  ('netlify_runtime', 'netlify.function_runtime_seconds', 'gte', 70, 90, 'netlify.function_runtime', 24, 'Netlify function runtime this month, % of plan'),
  ('netlify_bandwidth', 'netlify.bandwidth_bytes', 'gte', 70, 90, 'netlify.bandwidth', 24, 'Netlify bandwidth this month, % of plan'),
  ('ai_spend_today', 'ai.spend_today_pct_of_cap', 'gte', 60, 90, null, 12, 'AI spend today, % of the global daily safeguard'),
  ('email_daily', 'email.sent_today', 'gte', 70, 90, 'resend.daily_emails', 12, 'Emails sent today, % of the daily plan limit'),
  ('storage_growth', 'storage.growth_ratio', 'gte', 3, 6, null, 24, 'Storage growth in the last day vs the 7-day average'),
  ('cleanup_failures', 'storage.queue_failed', 'gte', 1, 10, null, 24, 'Storage deletions that failed permanently'),
  ('cleanup_backlog', 'storage.queue_pending', 'gte', 1000, 5000, null, 12, 'Storage deletions waiting'),
  ('cleanup_backlog_age', 'storage.queue_oldest_hours', 'gte', 48, 96, null, 12, 'Oldest waiting storage deletion, hours'),
  ('upload_failure_rate', 'storage.upload_failure_rate', 'gte', 5, 20, null, 12, 'Rejected or abandoned uploads in the last 24 h, %'),
  ('collector_stale', 'ops.collector_age_minutes', 'gte', 180, 360, null, 6, 'Minutes since the last successful metrics collection'),
  ('lifecycle_stale', 'ops.lifecycle_age_minutes', 'gte', 60, 180, null, 6, 'Minutes since the last successful storage lifecycle run'),
  ('lifecycle_circuit_breaker', 'storage.circuit_breaker', 'gte', null, 1, null, 24, 'Storage lifecycle stopped by the circuit breaker'),
  ('soniox_month', 'soniox.cost_month_usd', 'gte', 20, 50, null, 24, 'Soniox transcription cost this month, USD')
on conflict (key) do nothing;

insert into private.ops_collector_state (collector, interval_minutes) values
  ('metrics', 60), ('lifecycle', 10), ('daily', 1440)
on conflict (collector) do nothing;

-- ── Backfill the registry from existing feature rows ──────────────────────────────────────────
-- Historical attachments keep at least 7 days from today, so their owners are warned first.
insert into public.storage_files (bucket, object_key, category, scope, original_filename, mime_type, size_bytes,
  owner_user_id, workspace_id, entity_type, entity_id, status, created_at, activated_at, retention_grace_until)
select 'attachments', a.storage_path, 'task_attachment', 'personal', left(a.filename, 255),
  coalesce(o.metadata ->> 'mimetype', a.mime), coalesce((o.metadata ->> 'size')::bigint, a.byte_size, 0),
  a.user_id, null, a.entity_type, a.entity_id, case when o.id is null then 'missing' else 'active' end,
  a.created_at, a.created_at, now() + interval '7 days'
from public.attachments a
left join storage.objects o on o.bucket_id = 'attachments' and o.name = a.storage_path
where a.file_id is null
on conflict do nothing;

insert into public.storage_files (bucket, object_key, category, scope, original_filename, mime_type, size_bytes,
  owner_user_id, workspace_id, entity_type, entity_id, status, created_at, activated_at, retention_grace_until)
select 'attachments', a.storage_path, 'task_attachment', 'workspace', left(a.filename, 255),
  coalesce(o.metadata ->> 'mimetype', a.mime), coalesce((o.metadata ->> 'size')::bigint, a.byte_size, 0),
  a.uploaded_by, a.workspace_id, a.entity_type, a.entity_id, case when o.id is null then 'missing' else 'active' end,
  a.created_at, a.created_at, now() + interval '7 days'
from public.workspace_attachments a
left join storage.objects o on o.bucket_id = 'attachments' and o.name = a.storage_path
where a.file_id is null
on conflict do nothing;

insert into public.storage_files (bucket, object_key, category, scope, mime_type, size_bytes,
  owner_user_id, workspace_id, entity_type, entity_id, status, created_at, activated_at)
select 'meeting-audio', s.storage_path, 'meeting_audio', 'personal',
  coalesce(o.metadata ->> 'mimetype', s.mime), coalesce((o.metadata ->> 'size')::bigint, s.byte_size, 0),
  s.user_id, null, 'meeting', s.meeting_id, case when o.id is null then 'missing' else 'active' end, s.created_at, s.created_at
from public.meeting_audio_segments s
left join storage.objects o on o.bucket_id = 'meeting-audio' and o.name = s.storage_path
where s.file_id is null
on conflict do nothing;

insert into public.storage_files (bucket, object_key, category, scope, mime_type, size_bytes,
  owner_user_id, workspace_id, entity_type, entity_id, status, created_at, activated_at)
select 'meeting-audio', s.storage_path, 'meeting_audio', 'workspace',
  coalesce(o.metadata ->> 'mimetype', s.mime), coalesce((o.metadata ->> 'size')::bigint, s.byte_size, 0),
  s.uploaded_by, s.workspace_id, 'meeting', s.meeting_id, case when o.id is null then 'missing' else 'active' end, s.created_at, s.created_at
from public.workspace_meeting_audio_segments s
left join storage.objects o on o.bucket_id = 'meeting-audio' and o.name = s.storage_path
where s.file_id is null
on conflict do nothing;

update public.attachments a set file_id = f.id from public.storage_files f
where a.file_id is null and f.bucket = 'attachments' and f.object_key = a.storage_path and f.status <> 'deleted';
update public.workspace_attachments a set file_id = f.id from public.storage_files f
where a.file_id is null and f.bucket = 'attachments' and f.object_key = a.storage_path and f.status <> 'deleted';
update public.meeting_audio_segments a set file_id = f.id from public.storage_files f
where a.file_id is null and f.bucket = 'meeting-audio' and f.object_key = a.storage_path and f.status <> 'deleted';
update public.workspace_meeting_audio_segments a set file_id = f.id from public.storage_files f
where a.file_id is null and f.bucket = 'meeting-audio' and f.object_key = a.storage_path and f.status <> 'deleted';

-- Queue rows recorded by 0045 link to their registry rows.
update private.storage_object_deletions d set file_id = f.id
from public.storage_files f
where d.file_id is null and f.bucket = d.bucket_id and f.object_key = d.object_name;
update public.storage_files f set status = 'deleting', deletion_requested_at = coalesce(f.deletion_requested_at, d.requested_at),
  deletion_reason = coalesce(f.deletion_reason, d.reason)
from private.storage_object_deletions d
where d.status = 'pending' and d.file_id = f.id and f.status in ('active', 'missing');

select private.storage_reconcile_usage();
