-- Extend report history for production reporting (Personal + Workspace).
-- Config/period/attribution also mirrored in branding jsonb for older clients.

alter table public.ai_reports
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists generated_by_name text,
  add column if not exists status text not null default 'ready',
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists snapshot jsonb not null default '{}'::jsonb;

alter table public.workspace_ai_reports
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists generated_by_name text,
  add column if not exists status text not null default 'ready',
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists snapshot jsonb not null default '{}'::jsonb;

drop policy if exists workspace_ai_reports_update on public.workspace_ai_reports;
create policy workspace_ai_reports_update on public.workspace_ai_reports
  for update using (
    created_by = auth.uid()
    or public.can_manage_workspace(workspace_id)
  )
  with check (
    created_by = auth.uid()
    or public.can_manage_workspace(workspace_id)
  );
