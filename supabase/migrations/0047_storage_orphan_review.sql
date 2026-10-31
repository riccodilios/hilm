-- An unregistered recording whose meeting still exists may be audio that never reached the
-- transcript (a failed segment registration). Such orphans are kept for review instead of being
-- purged after quarantine; orphans of deleted meetings or abandoned uploads purge as before.
create or replace function private.storage_orphan_review()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.status = 'orphaned' and new.category = 'meeting_audio' and (
       exists (select 1 from public.meetings m
               where (storage.foldername(new.object_key))[1] <> 'workspace'
                 and m.id = public.try_uuid((storage.foldername(new.object_key))[2]))
    or exists (select 1 from public.workspace_meetings m
               where (storage.foldername(new.object_key))[1] = 'workspace'
                 and m.id = public.try_uuid((storage.foldername(new.object_key))[3]))
  ) then
    new.purge_after := null;
    new.deletion_reason := 'orphan_review';
  end if;
  return new;
end;
$$;
revoke all on function private.storage_orphan_review() from public, anon, authenticated;

drop trigger if exists storage_files_orphan_review on public.storage_files;
create trigger storage_files_orphan_review
  before insert or update of status, purge_after on public.storage_files
  for each row execute function private.storage_orphan_review();

update public.storage_files set purge_after = purge_after where status = 'orphaned' and category = 'meeting_audio';
