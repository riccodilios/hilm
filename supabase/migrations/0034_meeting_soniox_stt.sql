-- Meeting transcription provider state: Soniox async STT (primary) with the existing
-- per-part Gemini transcription as the automatic fallback.
--
-- 1. Additive stt_* columns on both meeting tables record which provider produced the
--    transcript, the external Soniox job/file, the provider state machine, the fallback
--    flag and the internal failure reason. Historical meetings keep stt_state = null.
-- 2. ai_usage_events gains provider + stt_route so the ledger distinguishes Soniox primary,
--    Gemini fallback and legacy Gemini-only transcription. tag_ai_usage_event sets them on
--    the caller's own events; begin/complete_ai_request are unchanged.
-- 3. Soniox has its own pricing row so a missing cost is never estimated with Gemini rates.
-- 4. meeting_stt_webhook lets the Soniox webhook flag a job as finished. It only accepts a
--    request carrying the per-job secret whose hash is stored on the meeting; the server
--    re-checks the job status with Soniox before acting on it.

do $$
declare
  v_table text;
begin
  foreach v_table in array array['meetings', 'workspace_meetings'] loop
    execute format(
      'alter table public.%I
         add column if not exists stt_provider text,
         add column if not exists stt_state text,
         add column if not exists stt_model text,
         add column if not exists stt_job_id text,
         add column if not exists stt_file_id text,
         add column if not exists stt_audio_hash text,
         add column if not exists stt_audio_ms integer,
         add column if not exists stt_usage_event_id uuid,
         add column if not exists stt_fallback boolean not null default false,
         add column if not exists stt_error text,
         add column if not exists stt_started_at timestamptz,
         add column if not exists stt_upload_claimed_at timestamptz,
         add column if not exists stt_submitted_at timestamptz,
         add column if not exists stt_checked_at timestamptz,
         add column if not exists stt_completed_at timestamptz,
         add column if not exists stt_webhook_token_hash text,
         add column if not exists stt_webhook_status text,
         add column if not exists stt_webhook_at timestamptz',
      v_table
    );
    begin
      execute format(
        'alter table public.%I add constraint %I check (stt_provider is null or stt_provider in (''soniox'', ''gemini''))',
        v_table, v_table || '_stt_provider_check'
      );
    exception when duplicate_object then null;
    end;
    begin
      execute format(
        'alter table public.%I add constraint %I check (stt_state is null or stt_state in (
           ''pending'', ''soniox_processing'', ''soniox_completed'', ''soniox_failed'',
           ''gemini_fallback'', ''gemini_processing'', ''completed'', ''failed''))',
        v_table, v_table || '_stt_state_check'
      );
    exception when duplicate_object then null;
    end;
    begin
      execute format(
        'alter table public.%I add constraint %I check (stt_webhook_status is null or stt_webhook_status in (''completed'', ''error''))',
        v_table, v_table || '_stt_webhook_status_check'
      );
    exception when duplicate_object then null;
    end;
    execute format(
      'create index if not exists %I on public.%I (stt_job_id) where stt_job_id is not null',
      v_table || '_stt_job_idx', v_table
    );
  end loop;
end $$;

-- ── Ledger: provider + transcription route ──────────────────────────────────
alter table public.ai_usage_events
  add column if not exists provider text,
  add column if not exists stt_route text;

do $$ begin
  alter table public.ai_usage_events
    add constraint ai_usage_events_stt_route_check
    check (stt_route is null or stt_route in ('soniox_primary', 'gemini_fallback', 'gemini_primary'));
exception when duplicate_object then null;
end $$;

create or replace function public.tag_ai_usage_event(
  p_event_id uuid,
  p_provider text,
  p_stt_route text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if p_provider is null or p_provider not in ('soniox', 'openrouter') then
    raise exception 'invalid_provider';
  end if;
  if p_stt_route is not null and p_stt_route not in ('soniox_primary', 'gemini_fallback', 'gemini_primary') then
    raise exception 'invalid_stt_route';
  end if;
  update public.ai_usage_events
  set provider = p_provider, stt_route = p_stt_route
  where id = p_event_id and user_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.tag_ai_usage_event(uuid, text, text) from public, anon;
grant execute on function public.tag_ai_usage_event(uuid, text, text) to authenticated, service_role;

-- Soniox async: $1.50 / 1M audio input tokens, $3.50 / 1M text tokens. Hilm passes the
-- computed cost explicitly; this row only guards the estimate fallback.
insert into public.ai_model_pricing (model, input_usd_per_1m, output_usd_per_1m) values
  ('soniox/stt-async-v5', 1.50, 3.50)
on conflict (model) do nothing;

-- ── Soniox webhook signal ───────────────────────────────────────────────────
create or replace function public.meeting_stt_webhook(
  p_os text,
  p_meeting_id uuid,
  p_job_id text,
  p_token text,
  p_status text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if p_os not in ('personal', 'workspace') or p_status not in ('completed', 'error') then
    return false;
  end if;
  if p_job_id is null or length(p_job_id) > 64 or p_token is null or length(p_token) < 32 or length(p_token) > 256 then
    return false;
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  if p_os = 'personal' then
    update public.meetings
    set stt_webhook_status = p_status, stt_webhook_at = now()
    where id = p_meeting_id
      and stt_state = 'soniox_processing'
      and stt_job_id = p_job_id
      and stt_webhook_token_hash = v_hash;
  else
    update public.workspace_meetings
    set stt_webhook_status = p_status, stt_webhook_at = now()
    where id = p_meeting_id
      and stt_state = 'soniox_processing'
      and stt_job_id = p_job_id
      and stt_webhook_token_hash = v_hash;
  end if;
  return found;
end;
$$;

revoke all on function public.meeting_stt_webhook(text, uuid, text, text, text) from public;
grant execute on function public.meeting_stt_webhook(text, uuid, text, text, text) to anon, authenticated, service_role;
