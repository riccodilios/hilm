-- Shared meeting links also carry the owner's saved English/Arabic translations of the summary,
-- key points, decisions and action items (never the transcript), so the public page can switch
-- languages without running new translations for anonymous viewers.
-- Same as 0035's get_shared_meeting plus the 'translations' field.

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
  v_translations jsonb;
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

  -- Only summary-side keys: summary, kp:<n>, dec:<id>, act:<id>:t|d. Each entry is {t, h}.
  execute format(
    'select coalesce(jsonb_object_agg(x.target_language, x.entries), ''{}''::jsonb)
     from (
       select tr.target_language,
              coalesce((
                select jsonb_object_agg(e.key, jsonb_build_object(''t'', e.value->>''t'', ''h'', e.value->>''h''))
                from jsonb_each(tr.entries) e
                where e.key = ''summary'' or e.key ~ ''^(kp|dec|act):''
              ), ''{}''::jsonb) as entries
       from public.%I tr
       where tr.meeting_id = $1 and tr.target_language in (''en'', ''ar'')
     ) x',
    v_prefix || 'meeting_translations'
  ) into v_translations using v_id;

  return jsonb_build_object(
    'meeting', v_meeting,
    'speakers', v_speakers,
    'transcript', v_transcript,
    'decisions', v_decisions,
    'action_items', v_actions,
    'translations', v_translations
  );
end;
$$;

revoke all on function public.get_shared_meeting(text) from public;
grant execute on function public.get_shared_meeting(text) to anon, authenticated;
