-- Allow workspace peers to read each other's public profile fields.
-- Root cause of Team page showing UUIDs: profiles_select_own hid peer names.

create policy profiles_select_workspace_peers on public.profiles
  for select using (
    exists (
      select 1
      from public.workspace_members me
      join public.workspace_members peer
        on peer.workspace_id = me.workspace_id
      where me.user_id = auth.uid()
        and peer.user_id = profiles.id
    )
  );

-- Directory view for Team UI: profile + optional email + workspace override + last activity.
create or replace function public.list_workspace_member_directory(p_workspace_id uuid)
returns table (
  user_id uuid,
  role public.workspace_role,
  joined_at timestamptz,
  display_name text,
  avatar_url text,
  email text,
  display_name_override text,
  last_active_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    m.user_id,
    m.role,
    m.joined_at,
    p.display_name,
    p.avatar_url,
    u.email::text,
    s.display_name_override,
    (
      select max(a.created_at)
      from public.workspace_activity_events a
      where a.workspace_id = p_workspace_id
        and a.actor_id = m.user_id
    ) as last_active_at
  from public.workspace_members m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  left join public.workspace_member_settings s
    on s.workspace_id = m.workspace_id
   and s.user_id = m.user_id
  where m.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
  order by m.joined_at;
$$;

revoke all on function public.list_workspace_member_directory(uuid) from public;
grant execute on function public.list_workspace_member_directory(uuid) to authenticated;
