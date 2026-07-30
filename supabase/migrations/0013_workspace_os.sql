-- Workspace OS: collaborative multi-tenant tables (separate from Personal OS)

create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.startup_mode as enum ('personal', 'workspace');

-- Additive settings for dual-OS startup (shared account surface)
alter table public.user_settings
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists default_startup_mode public.startup_mode not null default 'personal';

-- Existing users skip onboarding and stay on Personal OS
update public.user_settings
set onboarding_completed = true,
    default_startup_mode = 'personal'
where true;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  logo_url text,
  color text not null default '#60a5fa',
  invite_code text not null,
  owner_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug),
  unique (invite_code)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete restrict,
  name text not null,
  description text,
  icon text,
  color text not null default '#60a5fa',
  status public.project_status not null default 'active',
  priority public.priority not null default 'medium',
  completion_pct numeric(5,2) not null default 0 check (completion_pct >= 0 and completion_pct <= 100),
  health public.health_status not null default 'unengaged',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_projects_ws_idx on public.workspace_projects (workspace_id);

create table public.workspace_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.workspace_projects (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete restrict,
  assignee_id uuid references auth.users (id) on delete set null,
  title text not null,
  description text,
  priority public.priority not null default 'none',
  status public.task_status not null default 'todo',
  estimated_hours numeric(8,2),
  due_at timestamptz,
  due_date date,
  position numeric not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_tasks_ws_idx on public.workspace_tasks (workspace_id);
create index workspace_tasks_project_idx on public.workspace_tasks (project_id);

create table public.workspace_activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index workspace_activity_ws_idx on public.workspace_activity_events (workspace_id, created_at desc);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger workspace_projects_set_updated_at
  before update on public.workspace_projects
  for each row execute function public.set_updated_at();

create trigger workspace_tasks_set_updated_at
  before update on public.workspace_tasks
  for each row execute function public.set_updated_at();

-- Helpers
create or replace function public.generate_workspace_invite_code()
returns text
language plpgsql
as $$
declare
  code text;
begin
  loop
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.workspaces where invite_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.workspace_member_role(ws_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.workspace_members m
  where m.workspace_id = ws_id and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_edit_workspace_content(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_member_role(ws_id) in ('owner', 'admin', 'member'), false);
$$;

create or replace function public.can_manage_workspace(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_member_role(ws_id) in ('owner', 'admin'), false);
$$;

create or replace function public.is_workspace_owner(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_member_role(ws_id) = 'owner', false);
$$;

-- Create workspace + owner membership
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

  insert into public.workspaces (name, slug, description, color, invite_code, owner_id)
  values (trim(p_name), final_slug, p_description, coalesce(nullif(p_color, ''), '#60a5fa'), public.generate_workspace_invite_code(), uid)
  returning * into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws.id, uid, 'owner');

  insert into public.workspace_activity_events (workspace_id, actor_id, event_type, entity_type, entity_id, summary)
  values (ws.id, uid, 'workspace.created', 'workspace', ws.id, 'Workspace created');

  return ws;
end;
$$;

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

  select * into ws from public.workspaces
  where invite_code = upper(trim(p_code))
  limit 1;

  if ws.id is null then
    raise exception 'Invalid invite code';
  end if;

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

create or replace function public.regenerate_workspace_invite(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'Not allowed';
  end if;
  code := public.generate_workspace_invite_code();
  update public.workspaces set invite_code = code where id = p_workspace_id;
  insert into public.workspace_activity_events (workspace_id, actor_id, event_type, summary)
  values (p_workspace_id, auth.uid(), 'invite.regenerated', 'Invite code regenerated');
  return code;
end;
$$;

-- RLS
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_projects enable row level security;
alter table public.workspace_tasks enable row level security;
alter table public.workspace_activity_events enable row level security;

create policy workspaces_select_member on public.workspaces
  for select using (public.is_workspace_member(id));

create policy workspaces_update_manage on public.workspaces
  for update using (public.can_manage_workspace(id))
  with check (public.can_manage_workspace(id));

create policy workspaces_delete_owner on public.workspaces
  for delete using (public.is_workspace_owner(id));

-- Members: members can see roster; managers mutate (except owner row protection in app)
create policy workspace_members_select on public.workspace_members
  for select using (public.is_workspace_member(workspace_id));

create policy workspace_members_insert_manage on public.workspace_members
  for insert with check (public.can_manage_workspace(workspace_id));

create policy workspace_members_update_manage on public.workspace_members
  for update using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create policy workspace_members_delete_manage on public.workspace_members
  for delete using (
    public.can_manage_workspace(workspace_id)
    or user_id = auth.uid()
  );

create policy workspace_projects_select on public.workspace_projects
  for select using (public.is_workspace_member(workspace_id));

create policy workspace_projects_insert on public.workspace_projects
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and created_by = auth.uid()
  );

create policy workspace_projects_update on public.workspace_projects
  for update using (public.can_edit_workspace_content(workspace_id))
  with check (public.can_edit_workspace_content(workspace_id));

create policy workspace_projects_delete on public.workspace_projects
  for delete using (public.can_edit_workspace_content(workspace_id));

create policy workspace_tasks_select on public.workspace_tasks
  for select using (public.is_workspace_member(workspace_id));

create policy workspace_tasks_insert on public.workspace_tasks
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and created_by = auth.uid()
  );

create policy workspace_tasks_update on public.workspace_tasks
  for update using (public.can_edit_workspace_content(workspace_id))
  with check (public.can_edit_workspace_content(workspace_id));

create policy workspace_tasks_delete on public.workspace_tasks
  for delete using (public.can_edit_workspace_content(workspace_id));

create policy workspace_activity_select on public.workspace_activity_events
  for select using (public.is_workspace_member(workspace_id));

create policy workspace_activity_insert on public.workspace_activity_events
  for insert with check (
    public.is_workspace_member(workspace_id)
    and (actor_id is null or actor_id = auth.uid())
  );

grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.join_workspace_by_invite(text) to authenticated;
grant execute on function public.regenerate_workspace_invite(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.workspace_member_role(uuid) to authenticated;
grant execute on function public.can_edit_workspace_content(uuid) to authenticated;
grant execute on function public.can_manage_workspace(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
