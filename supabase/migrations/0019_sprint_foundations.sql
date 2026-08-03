-- Sprint foundations: time format, labels, attachments, org, CRM, balancer, reports.
-- Personal OS and Workspace OS remain isolated via separate tables / RLS.

-- ── Time format preference ──────────────────────────────────────────────────
alter table public.user_settings
  add column if not exists time_format text not null default '24h'
    check (time_format in ('12h', '24h'));

-- ── Personal attachments extras ─────────────────────────────────────────────
alter table public.attachments
  add column if not exists byte_size bigint,
  add column if not exists version integer not null default 1;

-- ── Workspace labels ────────────────────────────────────────────────────────
create table if not exists public.workspace_labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  color text not null default '#71717a',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.workspace_project_labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.workspace_projects (id) on delete cascade,
  label_id uuid not null references public.workspace_labels (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, label_id)
);

create index if not exists workspace_labels_ws_idx on public.workspace_labels (workspace_id);
create index if not exists workspace_project_labels_project_idx on public.workspace_project_labels (project_id);

alter table public.workspace_labels enable row level security;
alter table public.workspace_project_labels enable row level security;

drop policy if exists workspace_labels_select on public.workspace_labels;
create policy workspace_labels_select on public.workspace_labels
  for select using (public.is_workspace_member(workspace_id));
drop policy if exists workspace_labels_write on public.workspace_labels;
create policy workspace_labels_insert on public.workspace_labels
  for insert with check (public.can_edit_workspace_content(workspace_id));
create policy workspace_labels_update on public.workspace_labels
  for update using (public.can_edit_workspace_content(workspace_id))
  with check (public.can_edit_workspace_content(workspace_id));
create policy workspace_labels_delete on public.workspace_labels
  for delete using (public.can_edit_workspace_content(workspace_id));

drop policy if exists workspace_project_labels_select on public.workspace_project_labels;
create policy workspace_project_labels_select on public.workspace_project_labels
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_project_labels_insert on public.workspace_project_labels
  for insert with check (public.can_edit_workspace_content(workspace_id));
create policy workspace_project_labels_delete on public.workspace_project_labels
  for delete using (public.can_edit_workspace_content(workspace_id));

-- ── Workspace attachments ───────────────────────────────────────────────────
create table if not exists public.workspace_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  storage_path text not null,
  mime text,
  filename text not null,
  byte_size bigint,
  version integer not null default 1,
  uploaded_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists workspace_attachments_entity_idx
  on public.workspace_attachments (workspace_id, entity_type, entity_id);

alter table public.workspace_attachments enable row level security;

create policy workspace_attachments_select on public.workspace_attachments
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_attachments_insert on public.workspace_attachments
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and uploaded_by = auth.uid()
  );
create policy workspace_attachments_delete on public.workspace_attachments
  for delete using (
    public.can_edit_workspace_content(workspace_id)
    or uploaded_by = auth.uid()
  );

-- Storage: allow workspace/{wsId}/... paths for members (foldername[1] = 'workspace')
drop policy if exists attachments_storage_workspace on storage.objects;
create policy attachments_storage_workspace
  on storage.objects
  for all
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'workspace'
    and public.is_workspace_member(((storage.foldername(name))[2])::uuid)
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'workspace'
    and public.is_workspace_member(((storage.foldername(name))[2])::uuid)
  );

-- ── Org hierarchy ───────────────────────────────────────────────────────────
create table if not exists public.workspace_departments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id uuid references public.workspace_departments (id) on delete set null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  department_id uuid references public.workspace_departments (id) on delete set null,
  name text not null,
  description text,
  lead_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_team_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  team_id uuid not null references public.workspace_teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

alter table public.workspace_member_settings
  add column if not exists skills text[] not null default '{}',
  add column if not exists department_id uuid references public.workspace_departments (id) on delete set null,
  add column if not exists availability jsonb not null default '{}'::jsonb;

alter table public.workspace_projects
  add column if not exists team_id uuid references public.workspace_teams (id) on delete set null;

create index if not exists workspace_departments_ws_idx on public.workspace_departments (workspace_id);
create index if not exists workspace_teams_ws_idx on public.workspace_teams (workspace_id);
create index if not exists workspace_team_members_team_idx on public.workspace_team_members (team_id);

alter table public.workspace_departments enable row level security;
alter table public.workspace_teams enable row level security;
alter table public.workspace_team_members enable row level security;

create policy workspace_departments_select on public.workspace_departments
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_departments_manage on public.workspace_departments
  for all using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create policy workspace_teams_select on public.workspace_teams
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_teams_manage on public.workspace_teams
  for all using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create policy workspace_team_members_select on public.workspace_team_members
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_team_members_manage on public.workspace_team_members
  for all using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create trigger workspace_departments_updated_at before update on public.workspace_departments
  for each row execute function public.set_updated_at();
create trigger workspace_teams_updated_at before update on public.workspace_teams
  for each row execute function public.set_updated_at();

-- ── CRM integrations (stubs) ────────────────────────────────────────────────
do $$ begin
  create type public.crm_provider as enum (
    'salesforce', 'hubspot', 'zoho', 'dynamics', 'custom_rest'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.crm_integration_status as enum (
    'disconnected', 'configured', 'connected', 'error', 'syncing'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.workspace_crm_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.crm_provider not null,
  status public.crm_integration_status not null default 'disconnected',
  display_name text,
  sync_settings jsonb not null default '{}'::jsonb,
  credentials_encrypted text,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

alter table public.workspace_crm_integrations enable row level security;

create policy workspace_crm_select on public.workspace_crm_integrations
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_crm_manage on public.workspace_crm_integrations
  for all using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create trigger workspace_crm_updated_at before update on public.workspace_crm_integrations
  for each row execute function public.set_updated_at();

-- ── AI Load Balancer ────────────────────────────────────────────────────────
create table if not exists public.workspace_load_balance_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  mode text not null check (mode in ('manual', 'ai', 'auto')),
  created_by uuid not null references auth.users (id) on delete cascade,
  summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_load_balance_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id uuid not null references public.workspace_load_balance_runs (id) on delete cascade,
  task_id uuid not null references public.workspace_tasks (id) on delete cascade,
  suggested_assignee_id uuid references auth.users (id) on delete set null,
  score numeric not null default 0,
  rationale text,
  mode text not null check (mode in ('manual', 'ai', 'auto')),
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.workspace_load_balance_runs enable row level security;
alter table public.workspace_load_balance_suggestions enable row level security;

create policy workspace_lb_runs_select on public.workspace_load_balance_runs
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_lb_runs_insert on public.workspace_load_balance_runs
  for insert with check (
    public.can_edit_workspace_content(workspace_id)
    and created_by = auth.uid()
  );

create policy workspace_lb_sugg_select on public.workspace_load_balance_suggestions
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_lb_sugg_write on public.workspace_load_balance_suggestions
  for all using (public.can_edit_workspace_content(workspace_id))
  with check (public.can_edit_workspace_content(workspace_id));

-- ── Reports ─────────────────────────────────────────────────────────────────
create table if not exists public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  report_type text not null,
  title text not null,
  content_html text not null default '',
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_ai_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  report_type text not null,
  title text not null,
  content_html text not null default '',
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_reports enable row level security;
alter table public.workspace_ai_reports enable row level security;

create policy ai_reports_own on public.ai_reports
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy workspace_ai_reports_select on public.workspace_ai_reports
  for select using (public.is_workspace_member(workspace_id));
create policy workspace_ai_reports_insert on public.workspace_ai_reports
  for insert with check (
    public.is_workspace_member(workspace_id)
    and created_by = auth.uid()
  );
create policy workspace_ai_reports_delete on public.workspace_ai_reports
  for delete using (
    created_by = auth.uid()
    or public.can_manage_workspace(workspace_id)
  );
