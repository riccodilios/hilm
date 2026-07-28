-- Tasks must belong to projects + reminder / notification infrastructure

-- Ensure every user has an Inbox project for orphan task migration
insert into public.projects (user_id, name, description, icon, color, status, priority)
select u.id, 'Inbox', 'Default project for uncategorized work', 'inbox', '#a1a1aa', 'active', 'medium'
from auth.users u
where not exists (
  select 1 from public.projects p where p.user_id = u.id and p.name = 'Inbox'
);

update public.tasks t
set project_id = p.id
from public.projects p
where t.project_id is null
  and p.user_id = t.user_id
  and p.name = 'Inbox';

alter table public.tasks
  alter column project_id set not null;

alter table public.tasks
  drop constraint if exists tasks_project_id_fkey;

alter table public.tasks
  add constraint tasks_project_id_fkey
  foreign key (project_id) references public.projects (id) on delete restrict;

-- Structured due + reminder columns (due_at remains the canonical timestamptz)
alter table public.tasks
  add column if not exists due_date date,
  add column if not exists due_time time,
  add column if not exists reminder_datetime timestamptz,
  add column if not exists reminder_type text,
  add column if not exists notification_sent boolean not null default false;

update public.tasks
set due_date = (due_at at time zone 'utc')::date
where due_at is not null and due_date is null;

update public.tasks
set due_time = (due_at at time zone 'utc')::time
where due_at is not null and due_time is null;

update public.tasks
set reminder_datetime = reminder_at
where reminder_at is not null and reminder_datetime is null;

create type public.reminder_type as enum (
  '5m',
  '15m',
  '30m',
  '1h',
  'same_day_morning',
  '1d',
  '2d',
  '1w',
  'custom'
);

create type public.notification_channel as enum (
  'email',
  'push',
  'in_app'
);

create table if not exists public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  remind_at timestamptz not null,
  reminder_type public.reminder_type not null default '1h',
  channels public.notification_channel[] not null default array['email'::public.notification_channel],
  notification_sent boolean not null default false,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_reminders_due_idx
  on public.task_reminders (notification_sent, remind_at)
  where notification_sent = false;

create index if not exists task_reminders_user_idx
  on public.task_reminders (user_id, remind_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel public.notification_channel not null default 'in_app',
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  project_id uuid references public.projects (id) on delete set null,
  href text,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

create table if not exists public.project_notification_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  email_reminders boolean not null default true,
  push_notifications boolean not null default true,
  in_app_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id)
);

alter table public.user_settings
  add column if not exists default_reminder_type public.reminder_type not null default '1h',
  add column if not exists email_reminders_enabled boolean not null default true,
  add column if not exists push_notifications_enabled boolean not null default false;

-- Seed notification_prefs shape for existing rows
update public.user_settings
set notification_prefs = coalesce(notification_prefs, '{}'::jsonb) || jsonb_build_object(
  'email_reminders', true,
  'push_notifications', false,
  'default_reminder_type', '1h'
)
where notification_prefs is null
   or not (notification_prefs ? 'email_reminders');

create trigger task_reminders_updated_at before update on public.task_reminders
  for each row execute function public.set_updated_at();
create trigger project_notification_prefs_updated_at before update on public.project_notification_prefs
  for each row execute function public.set_updated_at();

alter table public.task_reminders enable row level security;
alter table public.notifications enable row level security;
alter table public.project_notification_prefs enable row level security;

create policy "task_reminders_all_own" on public.task_reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notifications_all_own" on public.notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "project_notif_prefs_all_own" on public.project_notification_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Helper: sync reminder_datetime onto tasks when primary reminder changes (app-layer preferred)
comment on column public.tasks.reminder_datetime is 'Primary/next reminder timestamp; multiple reminders live in task_reminders';
comment on column public.tasks.notification_sent is 'Legacy flag for single reminder; prefer task_reminders.notification_sent';
