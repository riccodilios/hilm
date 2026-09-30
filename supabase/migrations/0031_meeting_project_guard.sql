-- Meetings can be moved between projects. RLS on meetings only checks the row owner /
-- workspace, and the project FK accepts any existing project, so pin project_id to a
-- project in the same scope: the owner's own personal project, or a project of the
-- same workspace.

create or replace function public.meetings_project_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.user_id = new.user_id
  ) then
    raise exception 'Project not found' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists meetings_project_guard on public.meetings;
create trigger meetings_project_guard
  before insert or update of project_id, user_id on public.meetings
  for each row execute function public.meetings_project_guard();

create or replace function public.workspace_meetings_project_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_projects p
    where p.id = new.project_id and p.workspace_id = new.workspace_id
  ) then
    raise exception 'Project not found in this workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_meetings_project_guard on public.workspace_meetings;
create trigger workspace_meetings_project_guard
  before insert or update of project_id, workspace_id on public.workspace_meetings
  for each row execute function public.workspace_meetings_project_guard();

revoke all on function public.meetings_project_guard() from public, anon, authenticated;
revoke all on function public.workspace_meetings_project_guard() from public, anon, authenticated;
