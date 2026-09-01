-- Per-member page access (owner-configurable) + project health explanation + workspace realtime.

alter table public.workspace_members
  add column if not exists page_permissions jsonb not null default '{}'::jsonb;

alter table public.workspace_projects
  add column if not exists health_explanation text;

comment on column public.workspace_members.page_permissions is
  'Per-page read/write overrides for members. Owner/admin bypass in app. Shape: { "tasks": { "read": true, "write": true }, ... }';

do $$ begin
  alter publication supabase_realtime add table public.workspace_tasks;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.workspace_projects;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.workspace_activity_events;
exception when duplicate_object then null;
end $$;
