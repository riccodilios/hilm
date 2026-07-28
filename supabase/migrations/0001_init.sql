-- Hilm initial schema
create extension if not exists "pgcrypto";

create type public.task_status as enum (
  'backlog', 'todo', 'in_progress', 'waiting', 'testing', 'done', 'archived'
);
create type public.project_status as enum (
  'active', 'paused', 'completed', 'archived'
);
create type public.priority as enum (
  'none', 'low', 'medium', 'high', 'urgent'
);
create type public.health_status as enum (
  'healthy', 'warning', 'blocked', 'critical'
);
create type public.roadmap_horizon as enum (
  'now', 'next', 'later', 'future'
);
create type public.idea_status as enum (
  'inbox', 'exploring', 'accepted', 'rejected', 'converted'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'dark',
  default_model text not null default 'google/gemini-2.5-flash',
  notification_prefs jsonb not null default '{}'::jsonb,
  openrouter_api_key_encrypted text,
  has_openrouter_key boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  icon text,
  color text not null default '#60a5fa',
  status public.project_status not null default 'active',
  priority public.priority not null default 'medium',
  completion_pct numeric(5,2) not null default 0 check (completion_pct >= 0 and completion_pct <= 100),
  health public.health_status not null default 'healthy',
  health_explanation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#a1a1aa',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.entity_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tag_id, entity_type, entity_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  description text,
  priority public.priority not null default 'none',
  status public.task_status not null default 'todo',
  estimated_hours numeric(8,2),
  actual_hours numeric(8,2),
  due_at timestamptz,
  reminder_at timestamptz,
  position numeric not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position numeric not null default 0,
  created_at timestamptz not null default now()
);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  description text,
  impact int not null default 3 check (impact between 1 and 5),
  effort int not null default 3 check (effort between 1 and 5),
  priority public.priority not null default 'medium',
  status public.idea_status not null default 'inbox',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text,
  horizon public.roadmap_horizon not null default 'next',
  position numeric not null default 0,
  starts_at date,
  ends_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version text not null,
  notes text,
  shipped_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  notes text,
  held_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  body text not null default '',
  kind text not null default 'doc',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  log_date date not null,
  worked_on text,
  blockers text,
  hours numeric(6,2),
  wins text,
  tomorrow text,
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  project_id uuid references public.projects (id) on delete set null,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  agent_id text not null default 'chief_of_staff',
  project_id uuid references public.projects (id) on delete set null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  actions jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  storage_path text not null,
  mime text,
  filename text not null,
  created_at timestamptz not null default now()
);

create index tasks_user_due_idx on public.tasks (user_id, due_at);
create index tasks_user_status_idx on public.tasks (user_id, status);
create index tasks_project_status_idx on public.tasks (project_id, status);
create index projects_user_idx on public.projects (user_id, status);
create index notes_user_idx on public.notes (user_id, updated_at desc);
create index activity_user_idx on public.activity_events (user_id, created_at desc);
create index roadmap_project_idx on public.roadmap_items (project_id, horizon, position);
create index ai_messages_conv_idx on public.ai_messages (conversation_id, created_at);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at();
create trigger ideas_updated_at before update on public.ideas
  for each row execute function public.set_updated_at();
create trigger roadmap_items_updated_at before update on public.roadmap_items
  for each row execute function public.set_updated_at();
create trigger meetings_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
create trigger daily_logs_updated_at before update on public.daily_logs
  for each row execute function public.set_updated_at();
create trigger ai_conversations_updated_at before update on public.ai_conversations
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.projects enable row level security;
alter table public.tags enable row level security;
alter table public.entity_tags enable row level security;
alter table public.tasks enable row level security;
alter table public.subtasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.notes enable row level security;
alter table public.ideas enable row level security;
alter table public.roadmap_items enable row level security;
alter table public.releases enable row level security;
alter table public.meetings enable row level security;
alter table public.documents enable row level security;
alter table public.daily_logs enable row level security;
alter table public.activity_events enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.attachments enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

create policy "settings_all_own" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "projects_all_own" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tags_all_own" on public.tags for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "entity_tags_all_own" on public.entity_tags for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_all_own" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "subtasks_all_own" on public.subtasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "task_deps_all_own" on public.task_dependencies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes_all_own" on public.notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ideas_all_own" on public.ideas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "roadmap_all_own" on public.roadmap_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "releases_all_own" on public.releases for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meetings_all_own" on public.meetings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents_all_own" on public.documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily_logs_all_own" on public.daily_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "activity_all_own" on public.activity_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_conv_all_own" on public.ai_conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_msg_all_own" on public.ai_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "attachments_all_own" on public.attachments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments_storage_own"
on storage.objects for all
using (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1])
with check (bucket_id = 'attachments' and auth.uid()::text = (storage.foldername(name))[1]);
