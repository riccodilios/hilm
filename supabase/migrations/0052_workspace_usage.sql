-- Workspace usage for the workspace settings page. Members see the workspace's size; storage
-- against the quota and this month's AI usage are shown to owners and admins only.

create or replace function public.workspace_usage_summary(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_manage boolean;
  v_result jsonb;
  v_quota bigint;
  v_used bigint;
begin
  if auth.uid() is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  v_manage := coalesce(public.can_manage_workspace(p_workspace_id), false);

  v_result := jsonb_build_object(
    'ok', true,
    'can_see_costs', v_manage,
    'members', (select count(*) from public.workspace_members where workspace_id = p_workspace_id),
    'projects', (select count(*) from public.workspace_projects where workspace_id = p_workspace_id and status <> 'archived'),
    'tasks_open', (select count(*) from public.workspace_tasks where workspace_id = p_workspace_id and status not in ('done', 'archived')),
    'tasks_done', (select count(*) from public.workspace_tasks where workspace_id = p_workspace_id and status = 'done'),
    'meetings', (select count(*) from public.workspace_meetings where workspace_id = p_workspace_id),
    'meeting_minutes_month', (
      select round(coalesce(sum(duration_ms), 0) / 60000.0, 1)
      from public.meeting_minutes_ledger
      where workspace_id = p_workspace_id and created_at >= v_month_start
    )
  );

  if v_manage then
    select q.quota_bytes, q.used_bytes into v_quota, v_used from private.storage_quota_for('workspace', p_workspace_id, null) q;
    v_result := v_result || jsonb_build_object(
      'storage', jsonb_build_object(
        'used_bytes', coalesce(v_used, 0),
        'quota_bytes', v_quota,
        'files', (select coalesce(sum(files_active), 0) from public.storage_usage where scope_type = 'workspace' and scope_id = p_workspace_id),
        'attachments_bytes', (select coalesce(sum(bytes_active), 0) from public.storage_usage
                              where scope_type = 'workspace' and scope_id = p_workspace_id and category = 'task_attachment'),
        'audio_bytes', (select coalesce(sum(bytes_active), 0) from public.storage_usage
                        where scope_type = 'workspace' and scope_id = p_workspace_id and category = 'meeting_audio')
      ),
      'ai_month', (
        select jsonb_build_object(
          'requests', count(*) filter (where status in ('started', 'completed') and request_kind in ('chat', 'daily_log')),
          'tokens', coalesce(sum(total_tokens) filter (where status in ('completed', 'failed') and request_kind <> 'meeting_transcribe'), 0),
          'meeting_requests', count(*) filter (where status in ('started', 'completed') and request_kind like 'meeting_%'),
          'cost_usd', round(coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed')), 0), 4),
          'active_users', count(distinct user_id) filter (where status in ('started', 'completed'))
        )
        from public.ai_usage_events
        where workspace_id = p_workspace_id and created_at >= v_month_start
      )
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.workspace_usage_summary(uuid) from public, anon;
grant execute on function public.workspace_usage_summary(uuid) to authenticated;
