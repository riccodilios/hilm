-- Deleting a workspace sets ai_usage_events.workspace_id to null (FK on delete set null). Those
-- events stay workspace-scoped: personal usage only ever counts scope = 'personal'.
alter table public.ai_usage_events drop constraint if exists ai_usage_events_scope_check;
alter table public.ai_usage_events add constraint ai_usage_events_scope_check
  check ((scope = 'personal' and workspace_id is null) or scope = 'workspace');
