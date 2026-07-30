-- Account-level OS visibility preferences

alter table public.user_settings
  add column if not exists hide_workspace_os boolean not null default false,
  add column if not exists hide_personal_os boolean not null default false;
