-- Expand project health beyond the original four statuses.
-- NOTE: Postgres forbids using a newly added enum value in the same transaction.
-- Default change lives in 0012.

do $$ begin
  alter type public.health_status add value if not exists 'unengaged';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.health_status add value if not exists 'started';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.health_status add value if not exists 'active';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.health_status add value if not exists 'near_completion';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.health_status add value if not exists 'stalled';
exception when duplicate_object then null;
end $$;
