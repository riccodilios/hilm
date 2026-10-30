-- Transactional email (Resend).
--
-- Emails are queued in private.email_outbox by trusted code only: the reminder job (service
-- connection) and the security-definer triggers below. The email-dispatch Netlify function claims
-- due rows, re-checks permissions and preferences against live data, renders the email server-side
-- and sends it with the outbox row's idempotency key. Nothing here is reachable through PostgREST.

-- ── Per-user email preferences and formatting ───────────────────────────────
alter table public.user_settings
  add column if not exists email_workspace_enabled boolean not null default true,
  add column if not exists locale text check (locale in ('en', 'ar')),
  add column if not exists time_zone text check (time_zone is null or char_length(time_zone) between 1 and 64);

comment on column public.user_settings.email_workspace_enabled is
  'Email me when I am assigned a workspace task or mentioned in a workspace comment.';
comment on column public.user_settings.locale is 'Interface language last used (email language).';
comment on column public.user_settings.time_zone is 'IANA time zone last reported by the app (email due times).';

-- ── Outbox ──────────────────────────────────────────────────────────────────
create table if not exists private.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('task_reminder', 'workspace_task_assigned', 'workspace_mention')),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- One email per event, however often the event is replayed.
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  -- Entity ids only; content is read fresh at send time.
  payload jsonb not null default '{}'::jsonb,
  -- Rows sharing a group_key that are due together go out as one digest email.
  group_key text check (group_key is null or char_length(group_key) <= 200),
  -- Fixed once claimed so a retried send reuses the same Resend idempotency key.
  batch_key text,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts int not null default 0,
  send_after timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id text,
  -- Short machine code only (never provider messages, addresses or content).
  last_error text check (last_error is null or char_length(last_error) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_outbox_due_idx
  on private.email_outbox (send_after)
  where status in ('pending', 'sending');
create index if not exists email_outbox_group_idx
  on private.email_outbox (group_key)
  where status = 'pending' and group_key is not null;
create index if not exists email_outbox_message_idx
  on private.email_outbox (provider_message_id)
  where provider_message_id is not null;

-- Addresses Resend reported as hard-bounced or complained; never emailed again.
create table if not exists private.email_suppressions (
  email text primary key check (email = lower(email) and char_length(email) <= 254),
  reason text not null check (reason in ('bounced', 'complained', 'suppressed')),
  created_at timestamptz not null default now()
);

-- Processed Resend webhook deliveries (svix-id), so replays are ignored.
create table if not exists private.email_webhook_events (
  id text primary key check (char_length(id) <= 100),
  type text not null check (char_length(type) <= 64),
  email_id text,
  received_at timestamptz not null default now()
);

revoke all on table private.email_outbox, private.email_suppressions, private.email_webhook_events
  from public, anon, authenticated;
grant all on table private.email_outbox, private.email_suppressions, private.email_webhook_events
  to postgres;

create or replace function private.enqueue_email(
  p_kind text,
  p_user_id uuid,
  p_dedupe_key text,
  p_payload jsonb,
  p_group_key text,
  p_delay interval
)
returns void
language sql
security definer
set search_path = private, public
as $$
  insert into private.email_outbox (kind, user_id, dedupe_key, payload, group_key, send_after)
  values (p_kind, p_user_id, p_dedupe_key, p_payload, p_group_key, now() + p_delay)
  on conflict (dedupe_key) do nothing;
$$;

revoke all on function private.enqueue_email(text, uuid, text, jsonb, text, interval)
  from public, anon, authenticated;

-- Per-workspace "Mentions and assignments" switch (Workspace profile → notifications).
create or replace function private.wants_workspace_mentions(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((
    select (s.notification_prefs ->> 'mentions') is distinct from 'false'
    from public.workspace_member_settings s
    where s.workspace_id = p_workspace_id and s.user_id = p_user_id
  ), true);
$$;

revoke all on function private.wants_workspace_mentions(uuid, uuid) from public, anon, authenticated;

-- ── Workspace task assigned ─────────────────────────────────────────────────
-- Runs on the database's own view of the assignment (the row already passed RLS), so callers
-- cannot fabricate notifications for tasks they could not assign. The in-app notification used to
-- be inserted from the browser, which RLS rejects for other users.
create or replace function public.notify_workspace_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_task_key text;
  v_ref text;
  v_notification uuid;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if v_actor is not null and new.assignee_id = v_actor then return new; end if;

  begin
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = new.assignee_id
    ) or not private.wants_workspace_mentions(new.workspace_id, new.assignee_id) then
      return new;
    end if;

    select w.task_key into v_task_key from public.workspaces w where w.id = new.workspace_id;
    if v_task_key is not null and new.task_number is not null then
      v_ref := v_task_key || '-' || new.task_number;
    end if;

    insert into public.notifications
      (user_id, channel, type, title, body, entity_type, entity_id, href, metadata)
    values (
      new.assignee_id,
      'in_app',
      'workspace.task.assigned',
      'Task assigned',
      case when v_ref is not null
        then format('You were assigned %s — "%s"', v_ref, new.title)
        else format('You were assigned "%s"', new.title) end,
      'workspace_task',
      new.id,
      format('/workspace/%s/tasks/%s', new.workspace_id, new.id),
      jsonb_build_object(
        'workspace_id', new.workspace_id,
        'task_id', new.id,
        'task_ref', v_ref,
        'task_title', new.title
      )
    )
    returning id into v_notification;

    perform private.enqueue_email(
      'workspace_task_assigned',
      new.assignee_id,
      'workspace-task-assigned/' || v_notification,
      jsonb_build_object('task_id', new.id, 'workspace_id', new.workspace_id, 'actor_id', v_actor),
      'workspace-task-assigned/' || new.workspace_id || '/' || new.assignee_id,
      interval '2 minutes'
    );
  exception when others then
    -- Notifications must never block saving the task.
    raise warning 'notify_workspace_task_assignment failed: %', sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.notify_workspace_task_assignment() from public, anon, authenticated;

drop trigger if exists workspace_tasks_notify_assignment on public.workspace_tasks;
create trigger workspace_tasks_notify_assignment
  after insert or update of assignee_id on public.workspace_tasks
  for each row execute function public.notify_workspace_task_assignment();

-- ── Workspace comment mention ───────────────────────────────────────────────
-- workspace_comment_mentions inserts are already limited to the comment's author and to members
-- of the workspace (RLS + enforce_workspace_comment_mention).
create or replace function public.notify_workspace_comment_mention()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_task_id uuid;
  v_task_title text;
  v_task_number int;
  v_author uuid;
  v_content text;
  v_task_key text;
  v_ref text;
  v_author_name text;
  v_snippet text;
begin
  begin
    select c.task_id, c.author_user_id, c.content, t.title, t.task_number
      into v_task_id, v_author, v_content, v_task_title, v_task_number
    from public.workspace_task_comments c
    join public.workspace_tasks t on t.id = c.task_id
    where c.id = new.comment_id and c.workspace_id = new.workspace_id;

    if v_task_id is null or v_author = new.mentioned_user_id then return new; end if;
    if not private.wants_workspace_mentions(new.workspace_id, new.mentioned_user_id) then return new; end if;

    select w.task_key into v_task_key from public.workspaces w where w.id = new.workspace_id;
    v_ref := case when v_task_key is not null and v_task_number is not null
      then v_task_key || '-' || v_task_number else v_task_title end;

    select nullif(btrim(p.display_name), '') into v_author_name
    from public.profiles p where p.id = v_author;
    v_author_name := coalesce(v_author_name, 'Someone');

    v_snippet := left(
      regexp_replace(v_content, '@\{[0-9A-Fa-f-]{36}\}', '@member', 'g'),
      140
    );

    insert into public.notifications
      (user_id, channel, type, title, body, entity_type, entity_id, href, metadata)
    values (
      new.mentioned_user_id,
      'in_app',
      'workspace.task.mention',
      'New mention',
      format('%s mentioned you in %s', v_author_name, v_ref) || E'\n' || '“' || v_snippet || '”',
      'workspace_task_comment',
      new.comment_id,
      format('/workspace/%s/tasks/%s?comment=%s', new.workspace_id, v_task_id, new.comment_id),
      jsonb_build_object(
        'workspace_id', new.workspace_id,
        'task_id', v_task_id,
        'comment_id', new.comment_id,
        'task_ref', v_ref,
        'author_name', v_author_name,
        'snippet', v_snippet
      )
    );

    perform private.enqueue_email(
      'workspace_mention',
      new.mentioned_user_id,
      'workspace-mention/' || new.comment_id || '/' || new.mentioned_user_id,
      jsonb_build_object('comment_id', new.comment_id, 'task_id', v_task_id, 'workspace_id', new.workspace_id),
      'workspace-mention/' || new.workspace_id || '/' || new.mentioned_user_id,
      interval '1 minute'
    );
  exception when others then
    raise warning 'notify_workspace_comment_mention failed: %', sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.notify_workspace_comment_mention() from public, anon, authenticated;

drop trigger if exists workspace_comment_mentions_notify on public.workspace_comment_mentions;
create trigger workspace_comment_mentions_notify
  after insert on public.workspace_comment_mentions
  for each row execute function public.notify_workspace_comment_mention();
