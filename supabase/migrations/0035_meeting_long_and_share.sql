-- Long meetings and public meeting links.
--
-- 1. The per-meeting recording cap was 60 minutes on the free plan: the recorder stopped and
--    finalized the meeting at 60:00 and register_meeting_segment rejected later parts. Every plan
--    now allows meetings of up to 8 hours; monthly meeting minutes remain the cost control.
-- 2. Soniox jobs are limited to 300 minutes of audio and the whole job is joined in memory in a
--    background function, so long meetings are transcribed as consecutive overlapping windows.
--    stt_window / stt_window_count track which window is in flight.
-- 3. Long transcripts are analysed in resumable steps (one model call per request) so no step
--    exceeds the 60 s function budget; analysis_progress stores the finished steps.
-- 4. Public share links: a 256-bit token is generated in the database and only its SHA-256 hash
--    is stored. Share columns can only change through meeting_share_set; get_shared_meeting
--    returns an explicit allow-listed payload for a valid token and nothing else.

update public.ai_quota_tiers set meeting_max_minutes = 480 where meeting_max_minutes < 480;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['meetings', 'workspace_meetings'] loop
    execute format(
      'alter table public.%I
         add column if not exists stt_window integer not null default 0,
         add column if not exists stt_window_count integer,
         add column if not exists analysis_progress jsonb,
         add column if not exists share_token_hash text,
         add column if not exists share_enabled_at timestamptz,
         add column if not exists share_enabled_by uuid',
      v_table
    );
    execute format(
      'create unique index if not exists %I on public.%I (share_token_hash) where share_token_hash is not null',
      v_table || '_share_token_uidx', v_table
    );
  end loop;
end $$;

-- ── Share columns are written only by meeting_share_set ─────────────────────
-- RLS lets editors update any meeting column, so a trigger keeps the share state out of
-- direct client writes (the RPC sets a transaction-local flag).
create or replace function public.guard_meeting_share_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('hilm.meeting_share_rpc', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.share_token_hash := null;
    new.share_enabled_at := null;
    new.share_enabled_by := null;
  elsif new.share_token_hash is distinct from old.share_token_hash
     or new.share_enabled_at is distinct from old.share_enabled_at
     or new.share_enabled_by is distinct from old.share_enabled_by then
    new.share_token_hash := old.share_token_hash;
    new.share_enabled_at := old.share_enabled_at;
    new.share_enabled_by := old.share_enabled_by;
  end if;
  return new;
end;
$$;

drop trigger if exists meetings_share_guard on public.meetings;
create trigger meetings_share_guard before insert or update on public.meetings
  for each row execute function public.guard_meeting_share_columns();
drop trigger if exists workspace_meetings_share_guard on public.workspace_meetings;
create trigger workspace_meetings_share_guard before insert or update on public.workspace_meetings
  for each row execute function public.guard_meeting_share_columns();

-- ── Owner controls ──────────────────────────────────────────────────────────
-- p_action: 'enable' (keeps an existing link), 'rotate' (new link, old one stops working),
-- 'disable'. The plaintext token is returned only when a new one is created.
-- Personal: the owner. Workspace: the meeting creator (still an editor) or a workspace admin,
-- the same people who may delete the meeting.
create or replace function public.meeting_share_set(p_os text, p_meeting_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_enabled_at timestamptz;
  v_ws uuid;
  v_creator uuid;
  v_token text;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if p_action not in ('enable', 'rotate', 'disable') then
    return jsonb_build_object('ok', false, 'code', 'invalid_action');
  end if;

  if p_os = 'personal' then
    select share_token_hash, share_enabled_at into v_hash, v_enabled_at
    from public.meetings where id = p_meeting_id and user_id = v_uid;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  elsif p_os = 'workspace' then
    select share_token_hash, share_enabled_at, workspace_id, created_by
      into v_hash, v_enabled_at, v_ws, v_creator
    from public.workspace_meetings where id = p_meeting_id;
    if not found or not public.is_workspace_member(v_ws) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if not (
      (v_creator = v_uid and public.can_edit_workspace_content(v_ws))
      or public.can_manage_workspace(v_ws)
    ) then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_os');
  end if;

  if p_action = 'enable' and v_hash is not null then
    return jsonb_build_object('ok', true, 'enabled', true, 'token', null, 'enabled_at', v_enabled_at);
  end if;

  perform set_config('hilm.meeting_share_rpc', '1', true);
  if p_action = 'disable' then
    if p_os = 'personal' then
      update public.meetings
      set share_token_hash = null, share_enabled_at = null, share_enabled_by = null
      where id = p_meeting_id;
    else
      update public.workspace_meetings
      set share_token_hash = null, share_enabled_at = null, share_enabled_by = null
      where id = p_meeting_id;
    end if;
    perform set_config('hilm.meeting_share_rpc', '', true);
    return jsonb_build_object('ok', true, 'enabled', false, 'token', null, 'enabled_at', null);
  end if;

  v_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_enabled_at := now();
  if p_os = 'personal' then
    update public.meetings
    set share_token_hash = v_hash, share_enabled_at = v_enabled_at, share_enabled_by = v_uid
    where id = p_meeting_id;
  else
    update public.workspace_meetings
    set share_token_hash = v_hash, share_enabled_at = v_enabled_at, share_enabled_by = v_uid
    where id = p_meeting_id;
  end if;
  perform set_config('hilm.meeting_share_rpc', '', true);
  return jsonb_build_object('ok', true, 'enabled', true, 'token', v_token, 'enabled_at', v_enabled_at);
end;
$$;

revoke all on function public.meeting_share_set(text, uuid, text) from public, anon;
grant execute on function public.meeting_share_set(text, uuid, text) to authenticated;

-- ── Token lookup (shared by the public payload and the in-app link) ─────────
create or replace function public.meeting_share_lookup(p_token text)
returns table (os text, meeting_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  return query
    select 'personal'::text, m.id from public.meetings m where m.share_token_hash = v_hash
    union all
    select 'workspace'::text, w.id from public.workspace_meetings w where w.share_token_hash = v_hash
    limit 1;
end;
$$;

revoke all on function public.meeting_share_lookup(text) from public, anon, authenticated;

-- Public payload: an explicit allow-list. No owner/workspace/project ids, notes (description),
-- task links, audio paths, processing internals or member details.
create or replace function public.get_shared_meeting(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_os text;
  v_id uuid;
  v_prefix text;
  v_meeting jsonb;
  v_speakers jsonb;
  v_transcript jsonb;
  v_decisions jsonb;
  v_actions jsonb;
begin
  select l.os, l.meeting_id into v_os, v_id from public.meeting_share_lookup(p_token) l;
  if v_id is null then
    return null;
  end if;
  v_prefix := case when v_os = 'workspace' then 'workspace_' else '' end;

  execute format(
    'select jsonb_build_object(
       ''title'', m.title,
       ''status'', m.status,
       ''held_at'', coalesce(m.held_at, m.started_at, m.created_at),
       ''duration_seconds'', m.duration_seconds,
       ''language'', m.language,
       ''participants'', coalesce(to_jsonb(m.participants), ''[]''::jsonb),
       ''summary'', m.summary,
       ''key_points'', coalesce(to_jsonb(m.key_points), ''[]''::jsonb),
       ''shared_at'', m.share_enabled_at
     ) from public.%I m where m.id = $1',
    case when v_os = 'workspace' then 'workspace_meetings' else 'meetings' end
  ) into v_meeting using v_id;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
       ''id'', s.id, ''label'', s.label, ''display_name'', s.display_name, ''ordinal'', s.ordinal
     ) order by s.ordinal), ''[]''::jsonb)
     from public.%I s where s.meeting_id = $1',
    v_prefix || 'meeting_speakers'
  ) into v_speakers using v_id;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
       ''id'', t.id, ''speaker_id'', t.speaker_id, ''ordinal'', t.ordinal, ''start_ms'', t.start_ms,
       ''end_ms'', t.end_ms, ''text'', t.text, ''language'', t.language,
       ''languages'', coalesce(to_jsonb(t.languages), ''[]''::jsonb)
     ) order by t.ordinal), ''[]''::jsonb)
     from public.%I t where t.meeting_id = $1',
    v_prefix || 'meeting_transcript_segments'
  ) into v_transcript using v_id;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
       ''id'', d.id, ''text'', d.text, ''certainty'', d.certainty,
       ''source_segment_ids'', coalesce(to_jsonb(d.source_segment_ids), ''[]''::jsonb), ''ordinal'', d.ordinal
     ) order by d.ordinal), ''[]''::jsonb)
     from public.%I d where d.meeting_id = $1',
    v_prefix || 'meeting_decisions'
  ) into v_decisions using v_id;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
       ''id'', a.id, ''title'', a.title, ''description'', a.description,
       ''owner_speaker_id'', a.owner_speaker_id, ''owner_certainty'', a.owner_certainty,
       ''due_text'', a.due_text, ''due_date'', a.due_date, ''priority'', a.priority,
       ''certainty'', a.certainty,
       ''source_segment_ids'', coalesce(to_jsonb(a.source_segment_ids), ''[]''::jsonb), ''ordinal'', a.ordinal
     ) order by a.ordinal), ''[]''::jsonb)
     from public.%I a where a.meeting_id = $1',
    v_prefix || 'meeting_action_items'
  ) into v_actions using v_id;

  return jsonb_build_object(
    'meeting', v_meeting,
    'speakers', v_speakers,
    'transcript', v_transcript,
    'decisions', v_decisions,
    'action_items', v_actions
  );
end;
$$;

revoke all on function public.get_shared_meeting(text) from public;
grant execute on function public.get_shared_meeting(text) to anon, authenticated;

-- In-app destination for a signed-in recipient who can already open the meeting privately.
-- Returns null otherwise: the link never grants access to the private meeting.
create or replace function public.shared_meeting_app_link(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_os text;
  v_id uuid;
  v_project uuid;
  v_ws uuid;
begin
  if v_uid is null then
    return null;
  end if;
  select l.os, l.meeting_id into v_os, v_id from public.meeting_share_lookup(p_token) l;
  if v_id is null then
    return null;
  end if;
  if v_os = 'personal' then
    select project_id into v_project from public.meetings where id = v_id and user_id = v_uid;
    if not found or v_project is null then
      return null;
    end if;
    return jsonb_build_object('os', 'personal', 'meeting_id', v_id, 'project_id', v_project);
  end if;
  select project_id, workspace_id into v_project, v_ws from public.workspace_meetings where id = v_id;
  if v_project is null or not public.is_workspace_member(v_ws) then
    return null;
  end if;
  return jsonb_build_object('os', 'workspace', 'meeting_id', v_id, 'project_id', v_project, 'workspace_id', v_ws);
end;
$$;

revoke all on function public.shared_meeting_app_link(text) from public, anon;
grant execute on function public.shared_meeting_app_link(text) to authenticated;
