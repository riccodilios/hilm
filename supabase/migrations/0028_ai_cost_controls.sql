-- AI cost controls: analysis cache hash, audio content hash, runtime kill switches,
-- richer usage summary by feature, and more accurate model pricing rows.

-- ── Meeting analysis cache fingerprint ──────────────────────────────────────
alter table public.meetings
  add column if not exists analysis_input_hash text;

alter table public.workspace_meetings
  add column if not exists analysis_input_hash text;

alter table public.meeting_audio_segments
  add column if not exists content_hash text;

alter table public.workspace_meeting_audio_segments
  add column if not exists content_hash text;

create index if not exists meeting_audio_segments_content_hash_idx
  on public.meeting_audio_segments (meeting_id, content_hash)
  where content_hash is not null;

create index if not exists workspace_meeting_audio_segments_content_hash_idx
  on public.workspace_meeting_audio_segments (meeting_id, content_hash)
  where content_hash is not null;

-- ── Runtime kill switches (editable without redeploy) ───────────────────────
create table if not exists public.ai_runtime_controls (
  id text primary key default 'global',
  ai_enabled boolean not null default true,
  transcription_enabled boolean not null default true,
  analysis_enabled boolean not null default true,
  max_global_daily_cost_usd numeric(14, 6),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.ai_runtime_controls (id)
values ('global')
on conflict (id) do nothing;

alter table public.ai_runtime_controls enable row level security;

drop policy if exists ai_runtime_controls_select_authenticated on public.ai_runtime_controls;
create policy ai_runtime_controls_select_authenticated on public.ai_runtime_controls
  for select to authenticated using (true);

revoke insert, update, delete on public.ai_runtime_controls from authenticated, anon;
grant select on public.ai_runtime_controls to authenticated;
grant all on public.ai_runtime_controls to service_role;

create or replace function public.get_ai_runtime_controls()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.ai_runtime_controls%rowtype;
begin
  select * into v_row from public.ai_runtime_controls where id = 'global' limit 1;
  if not found then
    return jsonb_build_object(
      'ai_enabled', true,
      'transcription_enabled', true,
      'analysis_enabled', true,
      'max_global_daily_cost_usd', null
    );
  end if;
  return jsonb_build_object(
    'ai_enabled', v_row.ai_enabled,
    'transcription_enabled', v_row.transcription_enabled,
    'analysis_enabled', v_row.analysis_enabled,
    'max_global_daily_cost_usd', v_row.max_global_daily_cost_usd,
    'metadata', v_row.metadata
  );
end;
$$;

grant execute on function public.get_ai_runtime_controls() to authenticated, service_role;

-- ── Pricing table completeness (quota cost estimation accuracy) ─────────────
insert into public.ai_model_pricing (model, input_usd_per_1m, output_usd_per_1m) values
  ('google/gemini-2.5-pro', 1.25, 10.00),
  ('openai/gpt-4.1-mini', 0.40, 1.60),
  ('openai/gpt-4.1', 2.00, 8.00),
  ('meta-llama/llama-3.3-70b-instruct', 0.10, 0.30)
on conflict (model) do nothing;

-- ── Usage summary: break down by feature for cost observability ─────────────
create or replace function public.get_ai_usage_summary(
  p_user_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
    and status in ('started', 'completed')
    and created_at >= v_day_start;

  select count(*) into v_month_count
  from public.ai_usage_events
  where user_id = v_user_id
    and status in ('started', 'completed')
    and created_at >= v_month_start;

  select coalesce(sum(total_tokens), 0), coalesce(sum(estimated_cost_usd), 0)
  into v_day_tokens, v_day_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
    and created_at >= v_day_start;

  select coalesce(sum(total_tokens), 0), coalesce(sum(estimated_cost_usd), 0)
  into v_month_tokens, v_month_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
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
        'cost_day', coalesce(sum(estimated_cost_usd) filter (where created_at >= v_day_start and status = 'completed'), 0),
        'cost_month', coalesce(sum(estimated_cost_usd) filter (where created_at >= v_month_start and status = 'completed'), 0)
      ) as stats
    from public.ai_usage_events
    where user_id = v_user_id
    group by request_kind
  ) feature_rows;

  return jsonb_build_object(
    'tier', v_tier.id,
    'tier_name', v_tier.display_name,
    'usage', jsonb_build_object(
      'requests_day', v_day_count,
      'requests_month', v_month_count,
      'tokens_day', v_day_tokens,
      'tokens_month', v_month_tokens,
      'cost_day', v_day_cost,
      'cost_month', v_month_cost,
      'failed_day', v_failed_day
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
      'meeting_minutes_per_month', coalesce(v_tier.meeting_minutes_per_month, 300)
    )
  );
end;
$$;

grant execute on function public.get_ai_usage_summary(uuid) to authenticated, service_role;
