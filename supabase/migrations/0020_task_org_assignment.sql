-- Workspace task assignment to department / team / member (Workspace OS only).

alter table public.workspace_tasks
  add column if not exists department_id uuid references public.workspace_departments (id) on delete set null,
  add column if not exists team_id uuid references public.workspace_teams (id) on delete set null;

create index if not exists workspace_tasks_department_idx
  on public.workspace_tasks (workspace_id, department_id)
  where department_id is not null;

create index if not exists workspace_tasks_team_idx
  on public.workspace_tasks (workspace_id, team_id)
  where team_id is not null;
