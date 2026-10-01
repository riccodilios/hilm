-- Saved meeting translations (English <-> Arabic) and the 'meeting_translate' AI request kind.
-- One row per meeting + target language; entries map a source key (transcript segment id,
-- summary, key point, decision, action item field) to {t: translation, h: source hash}, so each
-- text is translated and billed once and edited sources are detected by hash.

create table if not exists public.meeting_translations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  target_language text not null check (target_language in ('en', 'ar')),
  entries jsonb not null default '{}'::jsonb check (jsonb_typeof(entries) = 'object'),
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, target_language)
);

create table if not exists public.workspace_meeting_translations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid not null references public.workspace_meetings (id) on delete cascade,
  target_language text not null check (target_language in ('en', 'ar')),
  entries jsonb not null default '{}'::jsonb check (jsonb_typeof(entries) = 'object'),
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, target_language)
);

drop trigger if exists meeting_translations_updated_at on public.meeting_translations;
create trigger meeting_translations_updated_at before update on public.meeting_translations
  for each row execute function public.set_updated_at();
drop trigger if exists workspace_meeting_translations_updated_at on public.workspace_meeting_translations;
create trigger workspace_meeting_translations_updated_at before update on public.workspace_meeting_translations
  for each row execute function public.set_updated_at();

alter table public.meeting_translations enable row level security;
alter table public.workspace_meeting_translations enable row level security;

-- The meeting must belong to the same owner, so nobody can squat another meeting's unique slot.
drop policy if exists meeting_translations_own on public.meeting_translations;
create policy meeting_translations_own on public.meeting_translations
  for all using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.user_id = auth.uid())
  );

drop policy if exists workspace_meeting_translations_select on public.workspace_meeting_translations;
create policy workspace_meeting_translations_select on public.workspace_meeting_translations
  for select using (public.is_workspace_member(workspace_id));
drop policy if exists workspace_meeting_translations_write on public.workspace_meeting_translations;
create policy workspace_meeting_translations_write on public.workspace_meeting_translations
  for all using (public.can_edit_workspace_content(workspace_id))
  with check (
    public.can_edit_workspace_content(workspace_id)
    and exists (
      select 1 from public.workspace_meetings m
      where m.id = meeting_id and m.workspace_id = workspace_meeting_translations.workspace_id
    )
  );

grant select, insert, update, delete on public.meeting_translations to authenticated;
grant select, insert, update, delete on public.workspace_meeting_translations to authenticated;

alter table public.ai_usage_events drop constraint if exists ai_usage_events_request_kind_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_request_kind_check
  check (request_kind in ('chat', 'daily_log', 'meeting_transcribe', 'meeting_analyze', 'meeting_translate'));

-- ── begin_ai_request: identical to 0032 plus the 'meeting_translate' kind ──────
-- Translation is a meeting kind (meeting concurrency + 90 s lock, no chat request counts) and
-- stays token-metered and spend-capped like analysis.
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
  v_global_cap numeric;
  v_global_cost numeric := 0;
  v_is_meeting boolean := p_request_kind in ('meeting_transcribe', 'meeting_analyze', 'meeting_translate');
  v_token_metered boolean := p_request_kind <> 'meeting_transcribe';
  v_max_concurrent integer;
  v_now timestamptz := now();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_error_code text;
  v_error_message text;
  v_fingerprint text;
  v_lock_ttl interval := case when p_request_kind in ('meeting_transcribe', 'meeting_analyze', 'meeting_translate')
    then interval '90 seconds' else interval '3 minutes' end;
  v_inflight_ttl interval := case when p_request_kind in ('meeting_transcribe', 'meeting_analyze', 'meeting_translate')
    then interval '90 seconds' else interval '3 minutes' end;
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

  if p_request_kind not in ('chat', 'daily_log', 'meeting_transcribe', 'meeting_analyze', 'meeting_translate') then
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
      if v_existing.status = 'started' and v_existing.created_at > v_now - v_inflight_ttl then
        return jsonb_build_object(
          'ok', false,
          'code', 'in_flight',
          'message', 'This AI request is already running. Please wait.',
          'event_id', v_existing.id,
          'status', v_existing.status
        );
      end if;
      -- failed / rejected / stale started: free the key so a clean retry can start, but keep
      -- the row so failed (possibly billed) attempts stay in the usage ledger.
      delete from public.ai_request_locks where usage_event_id = v_existing.id;
      update public.ai_usage_events
      set idempotency_key = null,
          status = case when status = 'started' then 'failed' else status end,
          error_code = case when status = 'started' then coalesce(error_code, 'abandoned') else error_code end,
          completed_at = coalesce(completed_at, v_now)
      where id = v_existing.id;
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
    and request_kind in ('chat', 'daily_log')
    and status in ('started', 'completed')
    and created_at > v_now - interval '1 minute';

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
    coalesce(sum(estimated_cost_usd), 0)
  into v_day_tokens, v_day_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
    and created_at >= v_day_start;

  select
    coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe'), 0),
    coalesce(sum(estimated_cost_usd), 0)
  into v_month_tokens, v_month_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
    and created_at >= v_month_start;

  select max_global_daily_cost_usd into v_global_cap
  from public.ai_runtime_controls
  where id = 'global';
  if coalesce(v_global_cap, 0) > 0 then
    select coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)), 0) into v_global_cost
    from public.ai_usage_events
    where created_at >= v_day_start
      and status in ('completed', 'failed');
  end if;

  select count(*) into v_concurrent
  from public.ai_request_locks l
  left join public.ai_usage_events e on e.id = l.usage_event_id
  where l.user_id = v_user_id
    and l.expires_at > v_now
    and (
      (v_is_meeting and e.request_kind in ('meeting_transcribe', 'meeting_analyze', 'meeting_translate'))
      or (not v_is_meeting and coalesce(e.request_kind, 'chat') in ('chat', 'daily_log'))
    );
  v_max_concurrent := case when v_is_meeting then greatest(v_tier.max_concurrent, 2) else v_tier.max_concurrent end;

  if coalesce(v_global_cap, 0) > 0 and v_global_cost >= v_global_cap then
    v_error_code := 'global_cost_limit';
    v_error_message := 'Hilm AI is paused for today because the service budget was reached. Please try again tomorrow.';
  elsif not v_is_meeting and v_minute_count >= v_tier.requests_per_minute then
    v_error_code := 'rate_limited';
    v_error_message := 'You are sending AI requests too quickly. Please wait a moment and try again.';
  elsif not v_is_meeting and v_day_count >= v_tier.requests_per_day then
    v_error_code := 'daily_request_limit';
    v_error_message := 'You have reached your daily AI request limit. It resets at midnight UTC.';
  elsif not v_is_meeting and v_month_count >= v_tier.requests_per_month then
    v_error_code := 'monthly_request_limit';
    v_error_message := 'You have reached your monthly AI request limit.';
  elsif v_token_metered and v_day_tokens >= v_tier.tokens_per_day then
    v_error_code := 'daily_token_limit';
    v_error_message := 'You have reached your daily AI token quota.';
  elsif v_token_metered and v_month_tokens >= v_tier.tokens_per_month then
    v_error_code := 'monthly_token_limit';
    v_error_message := 'You have reached your monthly AI token quota.';
  elsif v_day_cost >= v_tier.cost_usd_per_day then
    v_error_code := 'daily_cost_limit';
    v_error_message := 'You have reached your daily AI spend limit.';
  elsif v_month_cost >= v_tier.cost_usd_per_month then
    v_error_code := 'monthly_cost_limit';
    v_error_message := 'You have reached your monthly AI spend limit.';
  elsif v_concurrent >= v_max_concurrent then
    v_error_code := 'concurrent_limit';
    v_error_message := 'Another AI request is already running. Please wait for it to finish.';
  end if;

  if v_error_code is not null then
    -- Do NOT store idempotency_key on rejected rows — that poisoned meeting retries.
    insert into public.ai_usage_events (
      user_id, workspace_id, request_kind, model, status,
      error_code, error_message, idempotency_key, conversation_id, completed_at
    ) values (
      v_user_id, p_workspace_id, p_request_kind, p_model, 'rejected',
      v_error_code, v_error_message, null,
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
      select * into v_existing
      from public.ai_usage_events
      where user_id = v_user_id
        and idempotency_key = trim(p_idempotency_key)
      limit 1;
      return jsonb_build_object(
        'ok', false,
        'code', 'duplicate',
        'message', 'This AI request was already submitted.',
        'event_id', v_existing.id,
        'status', coalesce(v_existing.status, 'duplicate')
      );
  end;

  if v_fingerprint is not null then
    begin
      insert into public.ai_request_locks (user_id, fingerprint, usage_event_id, expires_at)
      values (v_user_id, v_fingerprint, v_event.id, v_now + v_lock_ttl);
    exception
      when unique_violation then
        update public.ai_usage_events
        set status = 'rejected',
            error_code = 'duplicate_execution',
            error_message = 'An identical AI request is already in progress.',
            completed_at = v_now,
            idempotency_key = null
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
      v_now + v_lock_ttl
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

grant execute on function public.begin_ai_request(text, text, uuid, uuid, text, text, uuid) to authenticated, service_role;

-- ── Usage summary: identical to 0032 plus translation tokens/spend in the meeting block ──
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
    and status in ('started', 'completed')
    and created_at >= v_day_start;

  select count(*) into v_month_count
  from public.ai_usage_events
  where user_id = v_user_id
    and status in ('started', 'completed')
    and created_at >= v_month_start;

  select
    coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe'), 0),
    coalesce(sum(estimated_cost_usd), 0)
  into v_day_tokens, v_day_cost
  from public.ai_usage_events
  where user_id = v_user_id
    and status = 'completed'
    and created_at >= v_day_start;

  select
    coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe'), 0),
    coalesce(sum(estimated_cost_usd), 0)
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
        'cost_month', coalesce(sum(estimated_cost_usd) filter (where created_at >= v_month_start and status = 'completed'), 0),
        'failed_tokens_day', coalesce(sum(total_tokens) filter (where created_at >= v_day_start and status = 'failed'), 0),
        'audio_ms_month', coalesce(sum(audio_ms) filter (where created_at >= v_month_start and status = 'completed'), 0)
      ) as stats
    from public.ai_usage_events
    where user_id = v_user_id
      and created_at >= v_month_start
    group by request_kind
  ) feature_rows;

  select
    coalesce((select sum(duration_ms) from public.meeting_audio_segments
              where user_id = v_user_id and created_at >= v_month_start), 0)
    + coalesce((select sum(duration_ms) from public.workspace_meeting_audio_segments
                where uploaded_by = v_user_id and created_at >= v_month_start), 0)
  into v_meeting_ms;

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
      'minutes_limit_month', coalesce(v_tier.meeting_minutes_per_month, 300),
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
      'meeting_minutes_per_month', coalesce(v_tier.meeting_minutes_per_month, 300)
    )
  );
end;
$$;

grant execute on function public.get_ai_usage_summary(uuid) to authenticated, service_role;
