-- Email engagement: workspace task updates + reminders, emailed workspace invitations,
-- product/marketing broadcasts with opt-out.

-- ── Preferences ─────────────────────────────────────────────────────────────
alter table public.user_settings
  add column if not exists email_marketing_enabled boolean not null default true;

comment on column public.user_settings.email_marketing_enabled is
  'Product news and announcements by email (opt-out; every email has one-click unsubscribe).';

-- ── Outbox kinds ────────────────────────────────────────────────────────────
alter table private.email_outbox drop constraint if exists email_outbox_kind_check;
alter table private.email_outbox add constraint email_outbox_kind_check check (kind in (
  'task_reminder',
  'workspace_task_assigned',
  'workspace_mention',
  'workspace_task_updated',
  'workspace_task_reminder',
  'broadcast'
));

-- ── Broadcasts (admin-composed product emails) ──────────────────────────────
create table if not exists private.email_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  audience text not null check (audience in ('all', 'en', 'ar')),
  -- { "en": { subject, preheader, heading, body, ctaLabel, ctaUrl }, "ar": { ... } }
  content jsonb not null,
  recipients int not null default 0,
  created_at timestamptz not null default now()
);

-- ── Emailed workspace invitations (rate limits + duplicate guard) ───────────
create table if not exists private.workspace_email_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254),
  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists workspace_email_invites_recent_idx
  on private.workspace_email_invites (workspace_id, created_at desc);
create index if not exists workspace_email_invites_email_idx
  on private.workspace_email_invites (workspace_id, email, created_at desc);

revoke all on table private.email_broadcasts, private.workspace_email_invites from public, anon, authenticated;
grant all on table private.email_broadcasts, private.workspace_email_invites to postgres;

-- Per-workspace "Task updates" switch (Workspace profile → notifications).
create or replace function private.wants_workspace_task_updates(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((
    select (s.notification_prefs ->> 'tasks') is distinct from 'false'
    from public.workspace_member_settings s
    where s.workspace_id = p_workspace_id and s.user_id = p_user_id
  ), true);
$$;

revoke all on function private.wants_workspace_task_updates(uuid, uuid) from public, anon, authenticated;

-- ── Task updated (status / priority / due / title) by someone else ─────────
create or replace function public.notify_workspace_task_update()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_changes jsonb := '{}'::jsonb;
  v_task_key text;
  v_ref text;
  v_actor_name text;
  v_summary text;
  v_notification uuid;
begin
  -- Reassignments are covered by notify_workspace_task_assignment.
  if new.assignee_id is null or old.assignee_id is distinct from new.assignee_id then return new; end if;
  if v_actor is null or v_actor = new.assignee_id then return new; end if;

  begin
    if new.status is distinct from old.status then
      v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('from', old.status::text, 'to', new.status::text));
    end if;
    if new.priority is distinct from old.priority then
      v_changes := v_changes || jsonb_build_object('priority', jsonb_build_object('from', old.priority::text, 'to', new.priority::text));
    end if;
    if new.due_at is distinct from old.due_at or new.due_date is distinct from old.due_date then
      v_changes := v_changes || jsonb_build_object('due', true);
    end if;
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('title', true);
    end if;
    if v_changes = '{}'::jsonb then return new; end if;

    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = new.assignee_id
    ) or not private.wants_workspace_task_updates(new.workspace_id, new.assignee_id) then
      return new;
    end if;

    select w.task_key into v_task_key from public.workspaces w where w.id = new.workspace_id;
    v_ref := case when v_task_key is not null and new.task_number is not null
      then v_task_key || '-' || new.task_number else null end;
    select nullif(btrim(p.display_name), '') into v_actor_name from public.profiles p where p.id = v_actor;
    v_summary := case
      when v_changes ? 'status' then format('status: %s', v_changes #>> '{status,to}')
      when v_changes ? 'due' then 'due date changed'
      when v_changes ? 'priority' then format('priority: %s', v_changes #>> '{priority,to}')
      else 'title changed' end;

    insert into public.notifications
      (user_id, channel, type, title, body, entity_type, entity_id, href, metadata)
    values (
      new.assignee_id,
      'in_app',
      'workspace.task.updated',
      'Task updated',
      format('%s updated %s — %s', coalesce(v_actor_name, 'Someone'), coalesce(v_ref, format('"%s"', new.title)), v_summary),
      'workspace_task',
      new.id,
      format('/workspace/%s/tasks/%s', new.workspace_id, new.id),
      jsonb_build_object('workspace_id', new.workspace_id, 'task_id', new.id, 'task_ref', v_ref, 'changes', v_changes)
    )
    returning id into v_notification;

    perform private.enqueue_email(
      'workspace_task_updated',
      new.assignee_id,
      'workspace-task-updated/' || v_notification,
      jsonb_build_object('task_id', new.id, 'workspace_id', new.workspace_id, 'actor_id', v_actor, 'changes', v_changes),
      'workspace-task-updated/' || new.workspace_id || '/' || new.assignee_id,
      interval '5 minutes'
    );
  exception when others then
    raise warning 'notify_workspace_task_update failed: %', sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.notify_workspace_task_update() from public, anon, authenticated;

drop trigger if exists workspace_tasks_notify_update on public.workspace_tasks;
create trigger workspace_tasks_notify_update
  after update of status, priority, due_at, due_date, title on public.workspace_tasks
  for each row execute function public.notify_workspace_task_update();

-- ── New comment on a task assigned to me (mentions are notified separately) ─
create or replace function public.notify_workspace_task_comment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_assignee uuid;
  v_title text;
  v_task_number int;
  v_task_key text;
  v_ref text;
  v_author_name text;
  v_notification uuid;
begin
  begin
    select t.assignee_id, t.title, t.task_number into v_assignee, v_title, v_task_number
    from public.workspace_tasks t
    where t.id = new.task_id and t.workspace_id = new.workspace_id;

    if v_assignee is null or v_assignee = new.author_user_id then return new; end if;
    -- An @mention of the assignee already notifies them.
    if position(('@{' || v_assignee::text || '}') in lower(new.content)) > 0 then return new; end if;
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = v_assignee
    ) or not private.wants_workspace_task_updates(new.workspace_id, v_assignee) then
      return new;
    end if;

    select w.task_key into v_task_key from public.workspaces w where w.id = new.workspace_id;
    v_ref := case when v_task_key is not null and v_task_number is not null
      then v_task_key || '-' || v_task_number else v_title end;
    select nullif(btrim(p.display_name), '') into v_author_name from public.profiles p where p.id = new.author_user_id;

    insert into public.notifications
      (user_id, channel, type, title, body, entity_type, entity_id, href, metadata)
    values (
      v_assignee,
      'in_app',
      'workspace.task.comment',
      'New comment',
      format('%s commented on %s', coalesce(v_author_name, 'Someone'), v_ref),
      'workspace_task_comment',
      new.id,
      format('/workspace/%s/tasks/%s?comment=%s', new.workspace_id, new.task_id, new.id),
      jsonb_build_object('workspace_id', new.workspace_id, 'task_id', new.task_id, 'comment_id', new.id, 'task_ref', v_ref)
    )
    returning id into v_notification;

    perform private.enqueue_email(
      'workspace_task_updated',
      v_assignee,
      'workspace-task-comment/' || new.id,
      jsonb_build_object('task_id', new.task_id, 'workspace_id', new.workspace_id, 'actor_id', new.author_user_id,
        'comment_id', new.id, 'changes', jsonb_build_object('comment', true)),
      'workspace-task-updated/' || new.workspace_id || '/' || v_assignee,
      interval '5 minutes'
    );
  exception when others then
    raise warning 'notify_workspace_task_comment failed: %', sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.notify_workspace_task_comment() from public, anon, authenticated;

drop trigger if exists workspace_task_comments_notify on public.workspace_task_comments;
create trigger workspace_task_comments_notify
  after insert on public.workspace_task_comments
  for each row execute function public.notify_workspace_task_comment();

-- ── Workspace task reminders (reminder_at was stored but never delivered) ───
alter table public.workspace_tasks
  add column if not exists reminder_sent_at timestamptz;

-- Existing past reminders are treated as handled so they do not all fire at once.
update public.workspace_tasks
set reminder_sent_at = now()
where reminder_at is not null and reminder_at <= now() and reminder_sent_at is null;

create or replace function public.reset_workspace_task_reminder()
returns trigger
language plpgsql
as $$
begin
  if new.reminder_at is distinct from old.reminder_at then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_tasks_reset_reminder on public.workspace_tasks;
create trigger workspace_tasks_reset_reminder
  before update of reminder_at on public.workspace_tasks
  for each row execute function public.reset_workspace_task_reminder();

create index if not exists workspace_tasks_reminder_due_idx
  on public.workspace_tasks (reminder_at)
  where reminder_at is not null and reminder_sent_at is null;
