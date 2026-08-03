-- Org visibility, assignment audit, team-lead distribution (no auto-assign lead as worker).
-- Workspace OS only.

-- Department manager + ordering
alter table public.workspace_departments
  add column if not exists head_user_id uuid references auth.users (id) on delete set null,
  add column if not exists sort_order integer not null default 0;

-- Assignment audit trail
create table if not exists public.workspace_assignment_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.workspace_tasks (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  from_department_id uuid references public.workspace_departments (id) on delete set null,
  to_department_id uuid references public.workspace_departments (id) on delete set null,
  from_team_id uuid references public.workspace_teams (id) on delete set null,
  to_team_id uuid references public.workspace_teams (id) on delete set null,
  from_assignee_id uuid references auth.users (id) on delete set null,
  to_assignee_id uuid references auth.users (id) on delete set null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workspace_assignment_events_task_idx
  on public.workspace_assignment_events (workspace_id, task_id, created_at desc);

alter table public.workspace_assignment_events enable row level security;

drop policy if exists workspace_assignment_events_select on public.workspace_assignment_events;
create policy workspace_assignment_events_select on public.workspace_assignment_events
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_assignment_events_insert on public.workspace_assignment_events;
create policy workspace_assignment_events_insert on public.workspace_assignment_events
  for insert with check (public.can_edit_workspace_content(workspace_id));

-- Managers can read member settings (skills/capacity) for AI assignment assist
drop policy if exists workspace_member_settings_select on public.workspace_member_settings;
create policy workspace_member_settings_select on public.workspace_member_settings
  for select using (
    user_id = auth.uid()
    or public.can_manage_workspace(workspace_id)
    or public.is_workspace_member(workspace_id)
  );

-- Visible departments: own home dept + all descendants. Owner/admin: all.
create or replace function public.workspace_user_home_department_id(p_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select department_id
  from public.workspace_member_settings
  where workspace_id = p_workspace_id
    and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.workspace_visible_department_ids(p_workspace_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  home_id uuid;
  role text;
begin
  if not public.is_workspace_member(p_workspace_id) then
    return;
  end if;

  role := public.workspace_member_role(p_workspace_id);
  if role in ('owner', 'admin') then
    return query
      select d.id from public.workspace_departments d
      where d.workspace_id = p_workspace_id;
    return;
  end if;

  home_id := public.workspace_user_home_department_id(p_workspace_id);
  if home_id is null then
    return;
  end if;

  return query
  with recursive tree as (
    select d.id, d.parent_id
    from public.workspace_departments d
    where d.workspace_id = p_workspace_id and d.id = home_id
    union all
    select c.id, c.parent_id
    from public.workspace_departments c
    inner join tree t on c.parent_id = t.id
    where c.workspace_id = p_workspace_id
  )
  select tree.id from tree;
end;
$$;

grant execute on function public.workspace_user_home_department_id(uuid) to authenticated;
grant execute on function public.workspace_visible_department_ids(uuid) to authenticated;
