-- Server-only secrets (not exposed via PostgREST to anon/authenticated)

create schema if not exists private;

create table if not exists private.server_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.server_secrets from public, anon, authenticated;
grant usage on schema private to postgres;
grant all on table private.server_secrets to postgres;
