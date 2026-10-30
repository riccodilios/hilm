-- Admin portal (private subdomain). Everything lives in the private schema: no PostgREST access,
-- only the Netlify admin API (service connection) reads or writes it.

-- Exactly one admin. The row is inserted by hand (see docs/admin-portal.md), never by the app.
create table if not exists private.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists admin_users_single_row on private.admin_users ((true));

-- Networks the admin may use (IPv4 /24 or IPv6 /64). The first MFA-verified request registers
-- its network; others need an emailed approval link opened from that network.
create table if not exists private.admin_allowed_networks (
  prefix text primary key check (char_length(prefix) <= 64),
  label text check (label is null or char_length(label) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists private.admin_network_approvals (
  token_hash text primary key check (char_length(token_hash) = 64),
  prefix text not null check (char_length(prefix) <= 64),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists private.admin_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_id uuid,
  action text not null check (char_length(action) <= 64),
  target text check (target is null or char_length(target) <= 200),
  network text check (network is null or char_length(network) <= 64),
  details jsonb not null default '{}'::jsonb
);
create index if not exists admin_audit_log_at_idx on private.admin_audit_log (at desc);

revoke all on table private.admin_users, private.admin_allowed_networks, private.admin_network_approvals,
  private.admin_audit_log from public, anon, authenticated;
grant all on table private.admin_users, private.admin_allowed_networks, private.admin_network_approvals,
  private.admin_audit_log to postgres;

-- The audit log is append-only, even for the admin API.
create or replace function private.admin_audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_log is append-only';
end;
$$;

drop trigger if exists admin_audit_log_no_update on private.admin_audit_log;
create trigger admin_audit_log_no_update
  before update or delete on private.admin_audit_log
  for each row execute function private.admin_audit_log_immutable();
