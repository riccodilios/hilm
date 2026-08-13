-- Workspace OS: short task keys (KEY-N) + task comments + @mentions
-- Personal OS tables are intentionally untouched.

-- ---------------------------------------------------------------------------
-- 1) Workspace short key (e.g. IMED) — persisted, unique, not regenerated
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists task_key text;

create or replace function public.derive_workspace_task_key(p_name text, p_slug text)
returns text
language plpgsql
as $$
declare
  raw text;
  base text;
  candidate text;
  n int := 0;
begin
  raw := upper(regexp_replace(coalesce(nullif(trim(p_name), ''), p_slug, 'WS'), '[^A-Za-z0-9]+', '', 'g'));
  if length(raw) < 2 then
    raw := upper(regexp_replace(coalesce(p_slug, 'WS'), '[^A-Za-z0-9]+', '', 'g'));
  end if;
  if length(raw) < 2 then
    raw := 'WS';
  end if;
  base := left(raw, 8);
  candidate := base;
  while exists (
    select 1 from public.workspaces w where w.task_key = candidate
  ) loop
    n := n + 1;
    candidate := left(base, greatest(2, 8 - length(n::text))) || n::text;
  end loop;
  return candidate;
end;
$$;

-- Sequential assignment avoids collisions inside a single UPDATE statement
do $$
declare
  r record;
begin
  for r in
    select id, name, slug
    from public.workspaces
    where task_key is null or btrim(task_key) = ''
    order by created_at asc, id asc
  loop
    update public.workspaces
    set task_key = public.derive_workspace_task_key(r.name, r.slug)
    where id = r.id;
  end loop;
end $$;

alter table public.workspaces
  alter column task_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspaces_task_key_key'
  ) then
    alter table public.workspaces add constraint workspaces_task_key_key unique (task_key);
  end if;
end $$;

alter table public.workspaces
  drop constraint if exists workspaces_task_key_format;
alter table public.workspaces
  add constraint workspaces_task_key_format
  check (task_key ~ '^[A-Z][A-Z0-9]{1,11}$');

-- Counters must exist before create_workspace writes to them
create table if not exists public.workspace_task_counters (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  last_number integer not null default 0 check (last_number >= 0)
);

insert into public.workspace_task_counters (workspace_id, last_number)
select w.id, 0
from public.workspaces w
on conflict (workspace_id) do nothing;

-- Keep create_workspace assigning task_key
create or replace function public.create_workspace(
  p_name text,
  p_description text default null,
  p_color text default '#60a5fa'
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ws public.workspaces;
  base_slug text;
  final_slug text;
  n int := 0;
  tkey text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if length(trim(p_name)) < 2 then
    raise exception 'Workspace name is required';
  end if;

  base_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then
    base_slug := 'workspace';
  end if;
  final_slug := base_slug;
  while exists (select 1 from public.workspaces where slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n::text;
  end loop;

  tkey := public.derive_workspace_task_key(trim(p_name), final_slug);

  insert into public.workspaces (name, slug, task_key, description, color, invite_code, owner_id)
  values (
    trim(p_name),
    final_slug,
    tkey,
    p_description,
    coalesce(nullif(p_color, ''), '#60a5fa'),
    public.generate_workspace_invite_code(),
    uid
  )
  returning * into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws.id, uid, 'owner');

  insert into public.workspace_task_counters (workspace_id, last_number)
  values (ws.id, 0)
  on conflict (workspace_id) do nothing;

  insert into public.workspace_activity_events (workspace_id, actor_id, event_type, entity_type, entity_id, summary)
  values (ws.id, uid, 'workspace.created', 'workspace', ws.id, 'Workspace created');

  return ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Per-workspace sequential task numbers (never reused)
-- ---------------------------------------------------------------------------
alter table public.workspace_tasks
  add column if not exists task_number integer;

-- Backfill existing tasks deterministically (created_at, id) — do not reuse later
do $$
declare
  ws record;
  t record;
  n int;
begin
  for ws in select id from public.workspaces loop
    n := 0;
    for t in
      select id
      from public.workspace_tasks
      where workspace_id = ws.id
        and task_number is null
      order by created_at asc, id asc
    loop
      n := n + 1;
      update public.workspace_tasks
      set task_number = n
      where id = t.id;
    end loop;

    update public.workspace_task_counters c
    set last_number = greatest(
      c.last_number,
      coalesce((select max(task_number) from public.workspace_tasks where workspace_id = ws.id), 0)
    )
    where c.workspace_id = ws.id;
  end loop;
end $$;

alter table public.workspace_tasks
  alter column task_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspace_tasks_workspace_id_task_number_key'
  ) then
    alter table public.workspace_tasks
      add constraint workspace_tasks_workspace_id_task_number_key unique (workspace_id, task_number);
  end if;
end $$;

create or replace function public.assign_workspace_task_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_num integer;
begin
  if new.task_number is not null then
    return new;
  end if;

  insert into public.workspace_task_counters (workspace_id, last_number)
  values (new.workspace_id, 1)
  on conflict (workspace_id) do update
    set last_number = public.workspace_task_counters.last_number + 1
  returning last_number into next_num;

  new.task_number := next_num;
  return new;
end;
$$;

drop trigger if exists workspace_tasks_assign_number on public.workspace_tasks;
create trigger workspace_tasks_assign_number
  before insert on public.workspace_tasks
  for each row
  execute function public.assign_workspace_task_number();

-- ---------------------------------------------------------------------------
-- 3) Comments + mentions
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.workspace_tasks (id) on delete cascade,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(btrim(content)) > 0 and char_length(content) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_task_comments_task_idx
  on public.workspace_task_comments (task_id, created_at asc);

create index if not exists workspace_task_comments_ws_idx
  on public.workspace_task_comments (workspace_id, created_at desc);

create trigger workspace_task_comments_set_updated_at
  before update on public.workspace_task_comments
  for each row execute function public.set_updated_at();

create table if not exists public.workspace_comment_mentions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  comment_id uuid not null references public.workspace_task_comments (id) on delete cascade,
  mentioned_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, mentioned_user_id)
);

create index if not exists workspace_comment_mentions_user_idx
  on public.workspace_comment_mentions (mentioned_user_id, created_at desc);

-- Author must be the authenticated user; mentioned user must be a workspace member
create or replace function public.enforce_workspace_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if new.author_user_id is distinct from auth.uid() then
    raise exception 'Cannot forge comment author';
  end if;
  if not public.is_workspace_member(new.workspace_id) then
    raise exception 'Not a workspace member';
  end if;
  if not exists (
    select 1 from public.workspace_tasks t
    where t.id = new.task_id and t.workspace_id = new.workspace_id
  ) then
    raise exception 'Task does not belong to workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_task_comments_enforce_author on public.workspace_task_comments;
create trigger workspace_task_comments_enforce_author
  before insert on public.workspace_task_comments
  for each row execute function public.enforce_workspace_comment_author();

create or replace function public.enforce_workspace_comment_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(new.workspace_id) then
    raise exception 'Not a workspace member';
  end if;
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = new.workspace_id
      and m.user_id = new.mentioned_user_id
  ) then
    raise exception 'Mentioned user is not a member of this workspace';
  end if;
  if not exists (
    select 1 from public.workspace_task_comments c
    where c.id = new.comment_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'Comment does not belong to workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_comment_mentions_enforce on public.workspace_comment_mentions;
create trigger workspace_comment_mentions_enforce
  before insert on public.workspace_comment_mentions
  for each row execute function public.enforce_workspace_comment_mention();

alter table public.workspace_task_comments enable row level security;
alter table public.workspace_comment_mentions enable row level security;
alter table public.workspace_task_counters enable row level security;

drop policy if exists workspace_task_comments_select on public.workspace_task_comments;
create policy workspace_task_comments_select on public.workspace_task_comments
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_task_comments_insert on public.workspace_task_comments;
create policy workspace_task_comments_insert on public.workspace_task_comments
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and author_user_id = auth.uid()
  );

drop policy if exists workspace_task_comments_update on public.workspace_task_comments;
create policy workspace_task_comments_update on public.workspace_task_comments
  for update using (
    public.can_edit_workspace_content(workspace_id)
    and author_user_id = auth.uid()
  )
  with check (
    public.can_edit_workspace_content(workspace_id)
    and author_user_id = auth.uid()
  );

drop policy if exists workspace_task_comments_delete on public.workspace_task_comments;
create policy workspace_task_comments_delete on public.workspace_task_comments
  for delete using (
    author_user_id = auth.uid()
    or public.can_manage_workspace(workspace_id)
  );

drop policy if exists workspace_comment_mentions_select on public.workspace_comment_mentions;
create policy workspace_comment_mentions_select on public.workspace_comment_mentions
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_comment_mentions_insert on public.workspace_comment_mentions;
create policy workspace_comment_mentions_insert on public.workspace_comment_mentions
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and exists (
      select 1 from public.workspace_task_comments c
      where c.id = comment_id
        and c.workspace_id = workspace_id
        and c.author_user_id = auth.uid()
    )
  );

drop policy if exists workspace_comment_mentions_delete on public.workspace_comment_mentions;
create policy workspace_comment_mentions_delete on public.workspace_comment_mentions
  for delete using (
    exists (
      select 1 from public.workspace_task_comments c
      where c.id = comment_id
        and c.author_user_id = auth.uid()
    )
    or public.can_manage_workspace(workspace_id)
  );

drop policy if exists workspace_task_counters_select on public.workspace_task_counters;
create policy workspace_task_counters_select on public.workspace_task_counters
  for select using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- 4) Realtime for workspace collaboration
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.workspace_task_comments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.workspace_comment_mentions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.workspace_tasks;
  exception when duplicate_object then null;
  end;
end $$;
