-- Label manage permission: owner/admin only for workspace label catalog.
-- Assignment (workspace_project_labels) stays can_edit_workspace_content.
-- What's New: track last acknowledged announcement version per user.

alter table public.user_settings
  add column if not exists last_seen_announcement_version text;

drop policy if exists workspace_labels_insert on public.workspace_labels;
drop policy if exists workspace_labels_update on public.workspace_labels;
drop policy if exists workspace_labels_delete on public.workspace_labels;

create policy workspace_labels_insert on public.workspace_labels
  for insert with check (public.can_manage_workspace(workspace_id));

create policy workspace_labels_update on public.workspace_labels
  for update using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create policy workspace_labels_delete on public.workspace_labels
  for delete using (public.can_manage_workspace(workspace_id));
