-- Roadmap and notes inside Workspace OS projects (the Personal OS tables are per-user).
-- Same access as workspace projects: members read, owners/admins/members write, viewers read only.

create table if not exists public.workspace_roadmap_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.workspace_projects (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  description text check (description is null or char_length(description) <= 5000),
  horizon public.roadmap_horizon not null default 'next',
  position numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_roadmap_items_project_idx
  on public.workspace_roadmap_items (project_id, horizon, position);

create table if not exists public.workspace_project_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.workspace_projects (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  title text not null default '' check (char_length(title) <= 300),
  body text not null default '' check (char_length(body) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_project_notes_project_idx
  on public.workspace_project_notes (project_id, updated_at desc);

drop trigger if exists workspace_roadmap_items_set_updated_at on public.workspace_roadmap_items;
create trigger workspace_roadmap_items_set_updated_at
  before update on public.workspace_roadmap_items
  for each row execute function public.set_updated_at();

drop trigger if exists workspace_project_notes_set_updated_at on public.workspace_project_notes;
create trigger workspace_project_notes_set_updated_at
  before update on public.workspace_project_notes
  for each row execute function public.set_updated_at();

-- A row's project must live in the row's workspace.
create or replace function public.workspace_project_in_workspace(p_project_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_projects p
    where p.id = p_project_id and p.workspace_id = p_workspace_id
  );
$$;

grant execute on function public.workspace_project_in_workspace(uuid, uuid) to authenticated;

alter table public.workspace_roadmap_items enable row level security;
alter table public.workspace_project_notes enable row level security;

drop policy if exists workspace_roadmap_items_select on public.workspace_roadmap_items;
create policy workspace_roadmap_items_select on public.workspace_roadmap_items
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_roadmap_items_insert on public.workspace_roadmap_items;
create policy workspace_roadmap_items_insert on public.workspace_roadmap_items
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and created_by = auth.uid()
    and public.workspace_project_in_workspace(project_id, workspace_id)
  );

drop policy if exists workspace_roadmap_items_update on public.workspace_roadmap_items;
create policy workspace_roadmap_items_update on public.workspace_roadmap_items
  for update using (public.can_edit_workspace_content(workspace_id))
  with check (
    public.can_edit_workspace_content(workspace_id)
    and public.workspace_project_in_workspace(project_id, workspace_id)
  );

drop policy if exists workspace_roadmap_items_delete on public.workspace_roadmap_items;
create policy workspace_roadmap_items_delete on public.workspace_roadmap_items
  for delete using (public.can_edit_workspace_content(workspace_id));

drop policy if exists workspace_project_notes_select on public.workspace_project_notes;
create policy workspace_project_notes_select on public.workspace_project_notes
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_project_notes_insert on public.workspace_project_notes;
create policy workspace_project_notes_insert on public.workspace_project_notes
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and created_by = auth.uid()
    and public.workspace_project_in_workspace(project_id, workspace_id)
  );

drop policy if exists workspace_project_notes_update on public.workspace_project_notes;
create policy workspace_project_notes_update on public.workspace_project_notes
  for update using (public.can_edit_workspace_content(workspace_id))
  with check (
    public.can_edit_workspace_content(workspace_id)
    and public.workspace_project_in_workspace(project_id, workspace_id)
  );

drop policy if exists workspace_project_notes_delete on public.workspace_project_notes;
create policy workspace_project_notes_delete on public.workspace_project_notes
  for delete using (public.can_edit_workspace_content(workspace_id));
