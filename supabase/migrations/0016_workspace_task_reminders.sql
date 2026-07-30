-- Reminder metadata for workspace tasks (UI parity with Personal OS create flow)

alter table public.workspace_tasks
  add column if not exists reminder_type text,
  add column if not exists reminder_at timestamptz;
