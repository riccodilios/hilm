-- Workspace AI conversations + per-member workspace preferences

alter table public.ai_conversations
  add column if not exists workspace_id uuid references public.workspaces (id) on delete set null;

create index if not exists ai_conversations_workspace_idx
  on public.ai_conversations (workspace_id)
  where workspace_id is not null;

-- Personal conversations stay workspace_id IS NULL; workspace chats are scoped.
-- Members can only see their own rows (existing RLS on user_id).

create table if not exists public.workspace_member_settings (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name_override text,
  avatar_url text,
  notification_prefs jsonb not null default '{}'::jsonb,
  appearance_prefs jsonb not null default '{}'::jsonb,
  ai_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create trigger workspace_member_settings_set_updated_at
  before update on public.workspace_member_settings
  for each row execute function public.set_updated_at();

alter table public.workspace_member_settings enable row level security;

create policy workspace_member_settings_select on public.workspace_member_settings
  for select using (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  );

create policy workspace_member_settings_upsert on public.workspace_member_settings
  for insert with check (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  );

create policy workspace_member_settings_update on public.workspace_member_settings
  for update using (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  );
