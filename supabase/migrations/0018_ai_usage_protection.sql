-- AI usage metering, cost protection, tier limits, and request locks.
-- Tier limits and model prices are editable in-table (no code deploy required).

create table if not exists public.ai_quota_tiers (
  id text primary key,
  display_name text not null,
  requests_per_minute integer not null default 10 check (requests_per_minute >= 0),
  requests_per_day integer not null default 100 check (requests_per_day >= 0),
  requests_per_month integer not null default 2000 check (requests_per_month >= 0),
  tokens_per_day bigint not null default 200000 check (tokens_per_day >= 0),
  tokens_per_month bigint not null default 4000000 check (tokens_per_month >= 0),
  cost_usd_per_day numeric(14, 6) not null default 1 check (cost_usd_per_day >= 0),
  cost_usd_per_month numeric(14, 6) not null default 20 check (cost_usd_per_month >= 0),
  max_concurrent integer not null default 1 check (max_concurrent >= 1),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.ai_quota_tiers (
  id, display_name,
  requests_per_minute, requests_per_day, requests_per_month,
  tokens_per_day, tokens_per_month,
  cost_usd_per_day, cost_usd_per_month, max_concurrent
) values
  ('free', 'Free', 8, 80, 1500, 150000, 3000000, 0.75, 12, 1),
  ('pro', 'Pro', 30, 500, 10000, 1000000, 20000000, 5, 100, 3),
  ('team', 'Team', 60, 2000, 40000, 4000000, 80000000, 20, 400, 8)
on conflict (id) do nothing;

create table if not exists public.ai_model_pricing (
  model text primary key,
  input_usd_per_1m numeric(14, 6) not null check (input_usd_per_1m >= 0),
  output_usd_per_1m numeric(14, 6) not null check (output_usd_per_1m >= 0),
  updated_at timestamptz not null default now()
);

insert into public.ai_model_pricing (model, input_usd_per_1m, output_usd_per_1m) values
  ('google/gemini-2.5-flash', 0.15, 0.60),
  ('google/gemini-2.0-flash', 0.10, 0.40),
  ('openai/gpt-4o-mini', 0.15, 0.60),
  ('openai/gpt-4o', 2.50, 10.00),
  ('anthropic/claude-3.5-sonnet', 3.00, 15.00),
  ('anthropic/claude-sonnet-4', 3.00, 15.00),
  ('default', 0.50, 1.50)
on conflict (model) do nothing;

alter table public.profiles
  add column if not exists ai_tier_id text not null default 'free';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_ai_tier_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_ai_tier_id_fkey
      foreign key (ai_tier_id) references public.ai_quota_tiers(id);
  end if;
end $$;

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  request_kind text not null check (request_kind in ('chat', 'daily_log')),
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  estimated_cost_usd numeric(16, 8) not null default 0 check (estimated_cost_usd >= 0),
  status text not null check (status in ('started', 'completed', 'failed', 'rejected', 'duplicate')),
  error_code text,
  error_message text,
  idempotency_key text,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists ai_usage_events_idempotency_uidx
  on public.ai_usage_events (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);

create index if not exists ai_usage_events_user_status_created_idx
  on public.ai_usage_events (user_id, status, created_at desc);

create index if not exists ai_usage_events_workspace_created_idx
  on public.ai_usage_events (workspace_id, created_at desc)
  where workspace_id is not null;

create table if not exists public.ai_request_locks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  usage_event_id uuid references public.ai_usage_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (user_id, fingerprint)
);

create index if not exists ai_request_locks_expires_idx
  on public.ai_request_locks (expires_at);

alter table public.ai_quota_tiers enable row level security;
alter table public.ai_model_pricing enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_request_locks enable row level security;

drop policy if exists ai_quota_tiers_select_authenticated on public.ai_quota_tiers;
create policy ai_quota_tiers_select_authenticated on public.ai_quota_tiers
  for select to authenticated using (true);

drop policy if exists ai_model_pricing_select_authenticated on public.ai_model_pricing;
create policy ai_model_pricing_select_authenticated on public.ai_model_pricing
  for select to authenticated using (true);

drop policy if exists ai_usage_events_select_own on public.ai_usage_events;
create policy ai_usage_events_select_own on public.ai_usage_events
  for select to authenticated using (auth.uid() = user_id);

-- Locks and usage writes go through SECURITY DEFINER RPCs only.
revoke insert, update, delete on public.ai_usage_events from authenticated, anon;
revoke insert, update, delete on public.ai_request_locks from authenticated, anon;
revoke all on public.ai_request_locks from authenticated, anon;

grant select on public.ai_quota_tiers to authenticated;
grant select on public.ai_model_pricing to authenticated;
grant select on public.ai_usage_events to authenticated;

create or replace function public.estimate_ai_cost(
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer
) returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_in numeric;
  v_out numeric;
begin
  select input_usd_per_1m, output_usd_per_1m
    into v_in, v_out
  from public.ai_model_pricing
  where model = coalesce(nullif(trim(p_model), ''), 'default')
  limit 1;

  if v_in is null then
    select input_usd_per_1m, output_usd_per_1m
      into v_in, v_out
    from public.ai_model_pricing
    where model = 'default'
    limit 1;
  end if;

  v_in := coalesce(v_in, 0.5);
  v_out := coalesce(v_out, 1.5);

  return round(
    (greatest(coalesce(p_input_tokens, 0), 0)::numeric / 1000000.0) * v_in
    + (greatest(coalesce(p_output_tokens, 0), 0)::numeric / 1000000.0) * v_out,
    8
  );
end;
$$;

create or replace function public.begin_ai_request(
  p_request_kind text,
  p_model text default null,
  p_workspace_id uuid default null,
  p_conversation_id uuid default null,
  p_idempotency_key text default null,
  p_fingerprint text default null,
  p_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_tier public.ai_quota_tiers%rowtype;
  v_event public.ai_usage_events%rowtype;
  v_existing public.ai_usage_events%rowtype;
  v_lock public.ai_request_locks%rowtype;
  v_minute_count integer;
  v_day_count integer;
  v_month_count integer;
  v_day_tokens bigint;
  v_month_tokens bigint;
  v_day_cost numeric;
  v_month_cost numeric;
  v_concurrent integer;
  v_now timestamptz := now();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_error_code text;
  v_error_message text;
  v_fingerprint text;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
    if p_user_id is not null and p_user_id <> v_user_id then
      raise exception 'forbidden';
    end if;
  elsif coalesce(auth.jwt()->>'role', '') = 'service_role' and p_user_id is not null then
    v_user_id := p_user_id;
  else
    raise exception 'unauthorized';
  end if;

  if p_request_kind not in ('chat', 'daily_log') then
    raise exception 'invalid_request_kind';
  end if;

  delete from public.ai_request_locks
  where user_id = v_user_id and expires_at < v_now;

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_existing
    from public.ai_usage_events
    where user_id = v_user_id
      and idempotency_key = trim(p_idempotency_key)
    limit 1;

    if found then
      if v_existing.status = 'completed' then
        return jsonb_build_object(
          'ok', false,
          'code', 'duplicate',
          'message', 'This AI request was already completed.',
          'event_id', v_existing.id,
          'status', v_existing.status
        );
      end if;
      if v_existing.status = 'started' and v_existing.created_at > v_now - interval '3 minutes' then
        return jsonb_build_object(
          'ok', false,
          'code', 'in_flight',
          'message', 'This AI request is already running. Please wait.',
          'event_id', v_existing.id,
          'status', v_existing.status
        );
      end if;
    end if;
  end if;

  v_fingerprint := nullif(trim(coalesce(p_fingerprint, '')), '');
  if v_fingerprint is not null then
    select * into v_lock
    from public.ai_request_locks
    where user_id = v_user_id
      and fingerprint = v_fingerprint
      and expires_at > v_now
    limit 1;
    if found then
      return jsonb_build_object(
        'ok', false,
        'code', 'duplicate_execution',
        'message', 'An identical AI request is already in progress.',
        'event_id', v_lock.usage_event_id
      );
    end if;
  end if;

  select t.* into v_tier
  from public.profiles p
  join public.ai_quota_tiers t on t.id = p.ai_tier_id
  where p.id = v_user_id
  limit 1;

  if not found then
    select * into v_tier from public.ai_quota_tiers where id = 'free' limit 1;
  end if;

  if not coalesce(v_tier.enabled, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'tier_disabled',
      'message', 'AI access is disabled for your plan. Contact support.'
    );
  end if;

  select count(*) into v_minute_count
  from public.ai_usage_events
  where user_id = v_user_id
    and status in ('started', 'completed')
    and created_at > v_now - interval '1 minute';

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

  select
    coalesce(sum(total_tokens), 0),
    coalesce(sum(estimated_cost_usd), 0)
  into v_day_tokens, v_day_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
    and created_at >= v_day_start;

  select
    coalesce(sum(total_tokens), 0),
    coalesce(sum(estimated_cost_usd), 0)
  into v_month_tokens, v_month_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
    and created_at >= v_month_start;

  select count(*) into v_concurrent
  from public.ai_request_locks
  where user_id = v_user_id
    and expires_at > v_now;

  if v_minute_count >= v_tier.requests_per_minute then
    v_error_code := 'rate_limited';
    v_error_message := 'You are sending AI requests too quickly. Please wait a moment and try again.';
  elsif v_day_count >= v_tier.requests_per_day then
    v_error_code := 'daily_request_limit';
    v_error_message := 'You have reached your daily AI request limit. It resets at midnight UTC.';
  elsif v_month_count >= v_tier.requests_per_month then
    v_error_code := 'monthly_request_limit';
    v_error_message := 'You have reached your monthly AI request limit.';
  elsif v_day_tokens >= v_tier.tokens_per_day then
    v_error_code := 'daily_token_limit';
    v_error_message := 'You have reached your daily AI token quota.';
  elsif v_month_tokens >= v_tier.tokens_per_month then
    v_error_code := 'monthly_token_limit';
    v_error_message := 'You have reached your monthly AI token quota.';
  elsif v_day_cost >= v_tier.cost_usd_per_day then
    v_error_code := 'daily_cost_limit';
    v_error_message := 'You have reached your daily AI spend limit.';
  elsif v_month_cost >= v_tier.cost_usd_per_month then
    v_error_code := 'monthly_cost_limit';
    v_error_message := 'You have reached your monthly AI spend limit.';
  elsif v_concurrent >= v_tier.max_concurrent then
    v_error_code := 'concurrent_limit';
    v_error_message := 'Another AI request is already running. Please wait for it to finish.';
  end if;

  if v_error_code is not null then
    insert into public.ai_usage_events (
      user_id, workspace_id, request_kind, model, status,
      error_code, error_message, idempotency_key, conversation_id, completed_at
    ) values (
      v_user_id, p_workspace_id, p_request_kind, p_model, 'rejected',
      v_error_code, v_error_message, nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_conversation_id, v_now
    )
    returning * into v_event;

    return jsonb_build_object(
      'ok', false,
      'code', v_error_code,
      'message', v_error_message,
      'event_id', v_event.id,
      'tier', v_tier.id,
      'usage', jsonb_build_object(
        'requests_minute', v_minute_count,
        'requests_day', v_day_count,
        'requests_month', v_month_count,
        'tokens_day', v_day_tokens,
        'tokens_month', v_month_tokens,
        'cost_day', v_day_cost,
        'cost_month', v_month_cost,
        'concurrent', v_concurrent
      ),
      'limits', jsonb_build_object(
        'requests_per_minute', v_tier.requests_per_minute,
        'requests_per_day', v_tier.requests_per_day,
        'requests_per_month', v_tier.requests_per_month,
        'tokens_per_day', v_tier.tokens_per_day,
        'tokens_per_month', v_tier.tokens_per_month,
        'cost_usd_per_day', v_tier.cost_usd_per_day,
        'cost_usd_per_month', v_tier.cost_usd_per_month,
        'max_concurrent', v_tier.max_concurrent
      )
    );
  end if;

  begin
    insert into public.ai_usage_events (
      user_id, workspace_id, request_kind, model, status,
      idempotency_key, conversation_id
    ) values (
      v_user_id, p_workspace_id, p_request_kind, p_model, 'started',
      nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_conversation_id
    )
    returning * into v_event;
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', false,
        'code', 'duplicate',
        'message', 'This AI request was already submitted.',
        'status', 'duplicate'
      );
  end;

  if v_fingerprint is not null then
    begin
      insert into public.ai_request_locks (user_id, fingerprint, usage_event_id, expires_at)
      values (v_user_id, v_fingerprint, v_event.id, v_now + interval '3 minutes');
    exception
      when unique_violation then
        update public.ai_usage_events
        set status = 'rejected',
            error_code = 'duplicate_execution',
            error_message = 'An identical AI request is already in progress.',
            completed_at = v_now
        where id = v_event.id;
        return jsonb_build_object(
          'ok', false,
          'code', 'duplicate_execution',
          'message', 'An identical AI request is already in progress.',
          'event_id', v_event.id
        );
    end;
  else
    insert into public.ai_request_locks (user_id, fingerprint, usage_event_id, expires_at)
    values (
      v_user_id,
      'event:' || v_event.id::text,
      v_event.id,
      v_now + interval '3 minutes'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'tier', v_tier.id,
    'usage', jsonb_build_object(
      'requests_minute', v_minute_count,
      'requests_day', v_day_count,
      'requests_month', v_month_count,
      'tokens_day', v_day_tokens,
      'tokens_month', v_month_tokens,
      'cost_day', v_day_cost,
      'cost_month', v_month_cost,
      'concurrent', v_concurrent
    ),
    'limits', jsonb_build_object(
      'requests_per_minute', v_tier.requests_per_minute,
      'requests_per_day', v_tier.requests_per_day,
      'requests_per_month', v_tier.requests_per_month,
      'tokens_per_day', v_tier.tokens_per_day,
      'tokens_per_month', v_tier.tokens_per_month,
      'cost_usd_per_day', v_tier.cost_usd_per_day,
      'cost_usd_per_month', v_tier.cost_usd_per_month,
      'max_concurrent', v_tier.max_concurrent
    )
  );
end;
$$;

create or replace function public.complete_ai_request(
  p_event_id uuid,
  p_status text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_model text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event public.ai_usage_events%rowtype;
  v_cost numeric;
  v_total integer;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  elsif coalesce(auth.jwt()->>'role', '') = 'service_role' and p_user_id is not null then
    v_user_id := p_user_id;
  else
    raise exception 'unauthorized';
  end if;

  if p_status not in ('completed', 'failed') then
    raise exception 'invalid_status';
  end if;

  select * into v_event
  from public.ai_usage_events
  where id = p_event_id
    and user_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_total := greatest(coalesce(p_input_tokens, 0), 0) + greatest(coalesce(p_output_tokens, 0), 0);
  v_cost := public.estimate_ai_cost(
    coalesce(p_model, v_event.model),
    coalesce(p_input_tokens, 0),
    coalesce(p_output_tokens, 0)
  );

  update public.ai_usage_events
  set
    status = p_status,
    input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
    output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
    total_tokens = v_total,
    estimated_cost_usd = case when p_status = 'completed' then v_cost else 0 end,
    model = coalesce(p_model, model),
    error_code = p_error_code,
    error_message = p_error_message,
    completed_at = now()
  where id = p_event_id
  returning * into v_event;

  delete from public.ai_request_locks
  where usage_event_id = p_event_id
     or (user_id = v_user_id and expires_at < now());

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'input_tokens', v_event.input_tokens,
    'output_tokens', v_event.output_tokens,
    'total_tokens', v_event.total_tokens,
    'estimated_cost_usd', v_event.estimated_cost_usd
  );
end;
$$;

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

  return jsonb_build_object(
    'tier', v_tier.id,
    'tier_name', v_tier.display_name,
    'usage', jsonb_build_object(
      'requests_day', v_day_count,
      'requests_month', v_month_count,
      'tokens_day', v_day_tokens,
      'tokens_month', v_month_tokens,
      'cost_day', v_day_cost,
      'cost_month', v_month_cost
    ),
    'limits', jsonb_build_object(
      'requests_per_minute', v_tier.requests_per_minute,
      'requests_per_day', v_tier.requests_per_day,
      'requests_per_month', v_tier.requests_per_month,
      'tokens_per_day', v_tier.tokens_per_day,
      'tokens_per_month', v_tier.tokens_per_month,
      'cost_usd_per_day', v_tier.cost_usd_per_day,
      'cost_usd_per_month', v_tier.cost_usd_per_month,
      'max_concurrent', v_tier.max_concurrent
    )
  );
end;
$$;

grant execute on function public.estimate_ai_cost(text, integer, integer) to authenticated, service_role;
grant execute on function public.begin_ai_request(text, text, uuid, uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.complete_ai_request(uuid, text, integer, integer, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.get_ai_usage_summary(uuid) to authenticated, service_role;
