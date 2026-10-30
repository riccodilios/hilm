-- In-app notification text: "|" instead of em dashes (same logic as 0037 / 0038).

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
        then format('You were assigned %s | "%s"', v_ref, new.title)
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
      format('%s updated %s | %s', coalesce(v_actor_name, 'Someone'), coalesce(v_ref, format('"%s"', new.title)), v_summary),
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
