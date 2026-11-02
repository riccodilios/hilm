-- Plan limits: Pro takes the previous Free limits, Free is tightened.
-- Meeting minutes are counted from an append-only ledger so deleting or editing
-- recordings cannot give minutes back.

update public.ai_quota_tiers set
  requests_per_minute = 8,
  requests_per_day = 80,
  requests_per_month = 1500,
  tokens_per_day = 150000,
  tokens_per_month = 3000000,
  cost_usd_per_day = 0.75,
  cost_usd_per_month = 12,
  max_concurrent = 1,
  meeting_max_minutes = 480,
  meeting_minutes_per_month = 300,
  meeting_max_retries = 3,
  updated_at = now()
where id = 'pro';

update public.ai_quota_tiers set
  requests_per_day = 30,
  requests_per_month = 900,
  tokens_per_day = 25000,
  meeting_minutes_per_month = 60,
  updated_at = now()
where id = 'free';

create table if not exists public.meeting_minutes_ledger (
  segment_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  os text not null check (os in ('personal', 'workspace')),
  meeting_id uuid not null,
  workspace_id uuid,
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists meeting_minutes_ledger_user_created_idx
  on public.meeting_minutes_ledger (user_id, created_at desc);

alter table public.meeting_minutes_ledger enable row level security;

drop policy if exists meeting_minutes_ledger_select_own on public.meeting_minutes_ledger;
create policy meeting_minutes_ledger_select_own on public.meeting_minutes_ledger
  for select to authenticated using (auth.uid() = user_id);

revoke all on public.meeting_minutes_ledger from anon, authenticated;
grant select on public.meeting_minutes_ledger to authenticated;

insert into public.meeting_minutes_ledger (segment_id, user_id, os, meeting_id, workspace_id, duration_ms, created_at)
select id, user_id, 'personal', meeting_id, null, greatest(duration_ms, 0), created_at
from public.meeting_audio_segments
on conflict (segment_id) do nothing;

insert into public.meeting_minutes_ledger (segment_id, user_id, os, meeting_id, workspace_id, duration_ms, created_at)
select id, uploaded_by, 'workspace', meeting_id, workspace_id, greatest(duration_ms, 0), created_at
from public.workspace_meeting_audio_segments
where uploaded_by is not null
on conflict (segment_id) do nothing;

create or replace function private.record_meeting_minutes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'meeting_audio_segments' then
    insert into public.meeting_minutes_ledger (segment_id, user_id, os, meeting_id, workspace_id, duration_ms, created_at)
    values (new.id, new.user_id, 'personal', new.meeting_id, null, greatest(new.duration_ms, 0), new.created_at)
    on conflict (segment_id) do nothing;
  elsif new.uploaded_by is not null then
    insert into public.meeting_minutes_ledger (segment_id, user_id, os, meeting_id, workspace_id, duration_ms, created_at)
    values (new.id, new.uploaded_by, 'workspace', new.meeting_id, new.workspace_id, greatest(new.duration_ms, 0), new.created_at)
    on conflict (segment_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.record_meeting_minutes() from public, anon, authenticated;

drop trigger if exists meeting_audio_segments_minutes_ledger on public.meeting_audio_segments;
create trigger meeting_audio_segments_minutes_ledger
  after insert on public.meeting_audio_segments
  for each row execute function private.record_meeting_minutes();

drop trigger if exists workspace_meeting_audio_segments_minutes_ledger on public.workspace_meeting_audio_segments;
create trigger workspace_meeting_audio_segments_minutes_ledger
  after insert on public.workspace_meeting_audio_segments
  for each row execute function private.record_meeting_minutes();

create or replace function private.meeting_minutes_used_ms(p_user_id uuid, p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(duration_ms), 0)::bigint
  from public.meeting_minutes_ledger
  where user_id = p_user_id and created_at >= p_since
$$;

revoke all on function private.meeting_minutes_used_ms(uuid, timestamptz) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.meeting_quota_status(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_tier public.ai_quota_tiers%rowtype;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_used_ms bigint;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  elsif coalesce(auth.jwt()->>'role', '') = 'service_role' and p_user_id is not null then
    v_user_id := p_user_id;
  else
    raise exception 'unauthorized';
  end if;

  select t.* into v_tier
  from public.profiles p
  join public.ai_quota_tiers t on t.id = p.ai_tier_id
  where p.id = v_user_id
  limit 1;
  if not found then
    select * into v_tier from public.ai_quota_tiers where id = 'free' limit 1;
  end if;

  v_used_ms := private.meeting_minutes_used_ms(v_user_id, v_month_start);

  return jsonb_build_object(
    'tier', v_tier.id,
    'enabled', coalesce(v_tier.enabled, false),
    'max_minutes', v_tier.meeting_max_minutes,
    'minutes_per_month', v_tier.meeting_minutes_per_month,
    'used_minutes_month', round(v_used_ms / 60000.0, 2),
    'used_ms_month', v_used_ms,
    'max_retries', v_tier.meeting_max_retries
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.register_meeting_segment(p_os text, p_meeting_id uuid, p_idx integer, p_storage_path text, p_duration_ms integer, p_offset_ms integer, p_mime text DEFAULT 'audio/wav'::text, p_byte_size bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_quota jsonb;
  v_meeting_ms bigint;
  v_existing uuid;
  v_id uuid;
  v_ws uuid;
  v_status text;
  v_duration integer := greatest(coalesce(p_duration_ms, 0), 0);
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if p_idx is null or p_idx < 0 or p_idx > 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_segment');
  end if;

  -- One minutes decision at a time per user, so parallel uploads cannot all pass the same check.
  perform pg_advisory_xact_lock(hashtextextended('hilm.meeting_quota:' || v_uid::text, 0));

  if p_os = 'personal' then
    select status into v_status from public.meetings
    where id = p_meeting_id and user_id = v_uid;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_storage_path not like (v_uid::text || '/' || p_meeting_id::text || '/%') then
      return jsonb_build_object('ok', false, 'code', 'invalid_path');
    end if;
    select id into v_existing from public.meeting_audio_segments
    where meeting_id = p_meeting_id and idx = p_idx;
    select coalesce(sum(duration_ms), 0) into v_meeting_ms
    from public.meeting_audio_segments where meeting_id = p_meeting_id;
  elsif p_os = 'workspace' then
    select status, workspace_id into v_status, v_ws from public.workspace_meetings
    where id = p_meeting_id;
    if not found or not public.can_edit_workspace_content(v_ws) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_storage_path not like ('workspace/' || v_ws::text || '/' || p_meeting_id::text || '/%') then
      return jsonb_build_object('ok', false, 'code', 'invalid_path');
    end if;
    select id into v_existing from public.workspace_meeting_audio_segments
    where meeting_id = p_meeting_id and idx = p_idx;
    select coalesce(sum(duration_ms), 0) into v_meeting_ms
    from public.workspace_meeting_audio_segments where meeting_id = p_meeting_id;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_os');
  end if;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'segment_id', v_existing, 'duplicate', true);
  end if;

  v_quota := public.meeting_quota_status(null);
  if not coalesce((v_quota->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'tier_disabled',
      'message', 'AI access is disabled for your plan.');
  end if;
  -- One minute of slack for rotation boundaries.
  if v_meeting_ms + v_duration > ((v_quota->>'max_minutes')::numeric * 60000) + 60000 then
    return jsonb_build_object('ok', false, 'code', 'meeting_too_long',
      'message', 'This meeting reached the maximum recording length for your plan.');
  end if;
  -- The recorder stops itself at the monthly limit; 15 seconds of slack keeps its final
  -- segment from being rejected over timing rounding.
  if (v_quota->>'used_ms_month')::bigint >= (v_quota->>'minutes_per_month')::numeric * 60000
     or (v_quota->>'used_ms_month')::bigint + v_duration > (v_quota->>'minutes_per_month')::numeric * 60000 + 15000 then
    return jsonb_build_object('ok', false, 'code', 'monthly_meeting_limit',
      'message', 'You reached your monthly meeting minutes.');
  end if;

  if p_os = 'personal' then
    insert into public.meeting_audio_segments (
      user_id, meeting_id, idx, storage_path, duration_ms, offset_ms, mime, byte_size
    ) values (
      v_uid, p_meeting_id, p_idx, p_storage_path, v_duration,
      greatest(coalesce(p_offset_ms, 0), 0), p_mime, p_byte_size
    )
    on conflict (meeting_id, idx) do nothing
    returning id into v_id;
    if v_status = 'draft' then
      update public.meetings set status = 'recording', started_at = coalesce(started_at, now())
      where id = p_meeting_id;
    elsif v_status in ('ready', 'failed') then
      update public.meetings set status = 'processing', processing_error = null
      where id = p_meeting_id;
    end if;
  else
    insert into public.workspace_meeting_audio_segments (
      workspace_id, meeting_id, uploaded_by, idx, storage_path, duration_ms, offset_ms, mime, byte_size
    ) values (
      v_ws, p_meeting_id, v_uid, p_idx, p_storage_path, v_duration,
      greatest(coalesce(p_offset_ms, 0), 0), p_mime, p_byte_size
    )
    on conflict (meeting_id, idx) do nothing
    returning id into v_id;
    if v_status = 'draft' then
      update public.workspace_meetings set status = 'recording', started_at = coalesce(started_at, now())
      where id = p_meeting_id;
    elsif v_status in ('ready', 'failed') then
      update public.workspace_meetings set status = 'processing', processing_error = null
      where id = p_meeting_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'segment_id', v_id);
end;
$function$;

-- Request counts shown to users match what begin_ai_request enforces (chat + daily log only).
CREATE OR REPLACE FUNCTION public.get_ai_usage_summary(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_tier public.ai_quota_tiers%rowtype;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_day_count integer;
  v_month_count integer;
  v_day_tokens bigint;
  v_month_tokens bigint;
  v_day_cost numeric;
  v_month_cost numeric;
  v_by_feature jsonb;
  v_failed_day integer;
  v_meeting_ms bigint;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  elsif coalesce(auth.jwt()->>'role', '') = 'service_role' and p_user_id is not null then
    v_user_id := p_user_id;
  else
    raise exception 'unauthorized';
  end if;

  select t.* into v_tier
  from public.profiles p
  join public.ai_quota_tiers t on t.id = p.ai_tier_id
  where p.id = v_user_id
  limit 1;

  if not found then
    select * into v_tier from public.ai_quota_tiers where id = 'free' limit 1;
  end if;

  select count(*) into v_day_count
  from public.ai_usage_events
  where user_id = v_user_id
    and request_kind in ('chat', 'daily_log')
    and status in ('started', 'completed')
    and created_at >= v_day_start;

  select count(*) into v_month_count
  from public.ai_usage_events
  where user_id = v_user_id
    and request_kind in ('chat', 'daily_log')
    and status in ('started', 'completed')
    and created_at >= v_month_start;

  select
    coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe'), 0),
    coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)), 0)
  into v_day_tokens, v_day_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status in ('completed', 'failed')
    and created_at >= v_day_start;

  select
    coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe'), 0),
    coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)), 0)
  into v_month_tokens, v_month_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status in ('completed', 'failed')
    and created_at >= v_month_start;

  select count(*) into v_failed_day
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'failed'
    and created_at >= v_day_start;

  select coalesce(jsonb_object_agg(request_kind, stats), '{}'::jsonb)
  into v_by_feature
  from (
    select
      request_kind,
      jsonb_build_object(
        'requests_day', count(*) filter (where created_at >= v_day_start and status in ('started', 'completed')),
        'requests_month', count(*) filter (where created_at >= v_month_start and status in ('started', 'completed')),
        'tokens_day', coalesce(sum(total_tokens) filter (where created_at >= v_day_start and status = 'completed'), 0),
        'tokens_month', coalesce(sum(total_tokens) filter (where created_at >= v_month_start and status = 'completed'), 0),
        'cost_day', coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where created_at >= v_day_start and status in ('completed', 'failed')), 0),
        'cost_month', coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where created_at >= v_month_start and status in ('completed', 'failed')), 0),
        'failed_tokens_day', coalesce(sum(total_tokens) filter (where created_at >= v_day_start and status = 'failed'), 0),
        'audio_ms_month', coalesce(sum(audio_ms) filter (where created_at >= v_month_start and status = 'completed'), 0)
      ) as stats
    from public.ai_usage_events
    where user_id = v_user_id
      and created_at >= v_month_start
    group by request_kind
  ) feature_rows;

  v_meeting_ms := private.meeting_minutes_used_ms(v_user_id, v_month_start);

  return jsonb_build_object(
    'tier', v_tier.id,
    'tier_name', v_tier.display_name,
    'tokens_scope', 'excludes_meeting_transcription',
    'usage', jsonb_build_object(
      'requests_day', v_day_count,
      'requests_month', v_month_count,
      'tokens_day', v_day_tokens,
      'tokens_month', v_month_tokens,
      'cost_day', v_day_cost,
      'cost_month', v_month_cost,
      'failed_day', v_failed_day
    ),
    'meeting', jsonb_build_object(
      'minutes_used_month', round(v_meeting_ms / 60000.0, 2),
      'minutes_limit_month', coalesce(v_tier.meeting_minutes_per_month, 60),
      'max_minutes_per_meeting', coalesce(v_tier.meeting_max_minutes, 60),
      'transcription_tokens_day', coalesce((v_by_feature->'meeting_transcribe'->>'tokens_day')::bigint, 0),
      'transcription_tokens_month', coalesce((v_by_feature->'meeting_transcribe'->>'tokens_month')::bigint, 0),
      'analysis_tokens_day', coalesce((v_by_feature->'meeting_analyze'->>'tokens_day')::bigint, 0),
      'analysis_tokens_month', coalesce((v_by_feature->'meeting_analyze'->>'tokens_month')::bigint, 0),
      'translation_tokens_day', coalesce((v_by_feature->'meeting_translate'->>'tokens_day')::bigint, 0),
      'translation_tokens_month', coalesce((v_by_feature->'meeting_translate'->>'tokens_month')::bigint, 0),
      'cost_day',
        coalesce((v_by_feature->'meeting_transcribe'->>'cost_day')::numeric, 0)
        + coalesce((v_by_feature->'meeting_analyze'->>'cost_day')::numeric, 0)
        + coalesce((v_by_feature->'meeting_translate'->>'cost_day')::numeric, 0),
      'cost_month',
        coalesce((v_by_feature->'meeting_transcribe'->>'cost_month')::numeric, 0)
        + coalesce((v_by_feature->'meeting_analyze'->>'cost_month')::numeric, 0)
        + coalesce((v_by_feature->'meeting_translate'->>'cost_month')::numeric, 0)
    ),
    'by_feature', v_by_feature,
    'limits', jsonb_build_object(
      'requests_per_minute', v_tier.requests_per_minute,
      'requests_per_day', v_tier.requests_per_day,
      'requests_per_month', v_tier.requests_per_month,
      'tokens_per_day', v_tier.tokens_per_day,
      'tokens_per_month', v_tier.tokens_per_month,
      'cost_usd_per_day', v_tier.cost_usd_per_day,
      'cost_usd_per_month', v_tier.cost_usd_per_month,
      'max_concurrent', v_tier.max_concurrent,
      'meeting_max_minutes', coalesce(v_tier.meeting_max_minutes, 60),
      'meeting_minutes_per_month', coalesce(v_tier.meeting_minutes_per_month, 60)
    )
  );
end;
$function$;
