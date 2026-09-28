-- Optional per-segment language list for multilingual / code-switched meetings.
-- Existing `language` stays the primary tag (en, ar, ar-SA, mixed, …).

alter table public.meeting_transcript_segments
  add column if not exists languages text[] not null default '{}';

alter table public.workspace_meeting_transcript_segments
  add column if not exists languages text[] not null default '{}';
