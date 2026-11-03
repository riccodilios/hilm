-- Workspace OS subscriptions, entitlements and scope-separated usage accounting.
--
-- One catalog (public.ai_quota_tiers) now holds every plan: Personal Free/Pro (scope 'personal',
-- assigned per user through profiles.ai_tier_id, unchanged) and Workspace Team/Team Pro (scope
-- 'workspace', held by public.workspace_subscriptions and attached to workspaces). Every AI usage
-- event carries an explicit scope: personal events count only against the user's personal plan,
-- workspace events only against the workspace's pooled plan. There is no fallback between them.

-- ── Plan catalog ─────────────────────────────────────────────────────────────────────────────
alter table public.ai_quota_tiers
  add column if not exists scope text not null default 'personal',
  add column if not exists price_sar_monthly numeric(10, 2) not null default 0,
  add column if not exists price_sar_yearly numeric(10, 2),
  add column if not exists max_workspaces integer,
  add column if not exists max_projects_per_workspace integer,
  add column if not exists storage_quota_bytes bigint,
  add column if not exists member_requests_per_day integer,
  add column if not exists features jsonb not null default '{}'::jsonb,
  add column if not exists sort_order integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_quota_tiers_scope_check') then
    alter table public.ai_quota_tiers add constraint ai_quota_tiers_scope_check check (scope in ('personal', 'workspace'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_quota_tiers_prices_check') then
    alter table public.ai_quota_tiers add constraint ai_quota_tiers_prices_check
      check (price_sar_monthly >= 0 and (price_sar_yearly is null or price_sar_yearly >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_quota_tiers_workspace_limits_check') then
    alter table public.ai_quota_tiers add constraint ai_quota_tiers_workspace_limits_check
      check ((max_workspaces is null or max_workspaces >= 0)
         and (max_projects_per_workspace is null or max_projects_per_workspace >= 0)
         and (storage_quota_bytes is null or storage_quota_bytes >= 0)
         and (member_requests_per_day is null or member_requests_per_day >= 0));
  end if;
end $$;

-- Personal plans keep their existing limits; only price and presentation are added.
update public.ai_quota_tiers set scope = 'personal', price_sar_monthly = 0, sort_order = 10,
  features = '{"personal_os": true, "workspace_create": false}'::jsonb, updated_at = now()
where id = 'free';
update public.ai_quota_tiers set scope = 'personal', price_sar_monthly = 30, sort_order = 20,
  features = '{"personal_os": true, "workspace_create": false}'::jsonb, updated_at = now()
where id = 'pro';

-- Workspace plans. Allowances are pooled per workspace; requests_per_minute, max_concurrent and
-- member_requests_per_day apply to each member as abuse protection (never charged personally).
insert into public.ai_quota_tiers (id, display_name) values ('team_pro', 'Team Pro') on conflict (id) do nothing;
update public.ai_quota_tiers set
  scope = 'workspace', display_name = 'Team', price_sar_monthly = 250, sort_order = 30,
  max_workspaces = 1, max_projects_per_workspace = 10, storage_quota_bytes = 5368709120,
  requests_per_minute = 10, requests_per_day = 400, requests_per_month = 6000,
  tokens_per_day = 750000, tokens_per_month = 12000000,
  cost_usd_per_day = 1.5, cost_usd_per_month = 15, max_concurrent = 2, member_requests_per_day = 120,
  meeting_max_minutes = 480, meeting_minutes_per_month = 1200, meeting_max_retries = 3, enabled = true,
  features = '{"workspace_os": true, "workspace_ai": true, "meetings": true, "reports": true}'::jsonb,
  updated_at = now()
where id = 'team';
update public.ai_quota_tiers set
  scope = 'workspace', display_name = 'Team Pro', price_sar_monthly = 400, sort_order = 40,
  max_workspaces = 3, max_projects_per_workspace = 10, storage_quota_bytes = 10737418240,
  requests_per_minute = 12, requests_per_day = 600, requests_per_month = 9000,
  tokens_per_day = 1100000, tokens_per_month = 18000000,
  cost_usd_per_day = 2.25, cost_usd_per_month = 22, max_concurrent = 3, member_requests_per_day = 160,
  meeting_max_minutes = 480, meeting_minutes_per_month = 1800, meeting_max_retries = 3, enabled = true,
  features = '{"workspace_os": true, "workspace_ai": true, "meetings": true, "reports": true}'::jsonb,
  updated_at = now()
where id = 'team_pro';

-- A personal account can only hold a personal plan.
create or replace function private.guard_personal_tier()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.ai_tier_id is distinct from old.ai_tier_id
     and not exists (select 1 from public.ai_quota_tiers t where t.id = new.ai_tier_id and t.scope = 'personal') then
    raise exception 'workspace_plan_not_personal' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_personal_tier() from public, anon, authenticated;
drop trigger if exists profiles_guard_personal_tier on public.profiles;
create trigger profiles_guard_personal_tier before update of ai_tier_id on public.profiles
  for each row execute function private.guard_personal_tier();

create or replace function private.set_ai_tier(p_user_id uuid, p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ai_quota_tiers where id = p_tier and scope = 'personal') then
    raise exception 'unknown_tier';
  end if;
  update public.profiles set ai_tier_id = p_tier where id = p_user_id;
  if not found then
    raise exception 'unknown_user';
  end if;
end;
$$;

-- ── Workspace subscriptions ──────────────────────────────────────────────────────────────────
create table if not exists public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.ai_quota_tiers (id),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'comped', 'past_due', 'canceled', 'expired')),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_days integer not null default 7 check (grace_days between 0 and 90),
  provider text not null default 'manual',
  provider_ref text,
  notes text,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_subscriptions_owner_idx on public.workspace_subscriptions (owner_user_id);

alter table public.workspaces add column if not exists subscription_id uuid
  references public.workspace_subscriptions (id) on delete set null;
create index if not exists workspaces_subscription_idx on public.workspaces (subscription_id);

create or replace function private.workspace_subscription_touch()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not exists (select 1 from public.ai_quota_tiers t where t.id = new.plan_id and t.scope = 'workspace') then
    raise exception 'personal_plan_not_workspace' using errcode = '23514';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.workspace_subscription_touch() from public, anon, authenticated;
drop trigger if exists workspace_subscriptions_touch on public.workspace_subscriptions;
create trigger workspace_subscriptions_touch before insert or update on public.workspace_subscriptions
  for each row execute function private.workspace_subscription_touch();

alter table public.workspace_subscriptions enable row level security;
drop policy if exists workspace_subscriptions_select on public.workspace_subscriptions;
create policy workspace_subscriptions_select on public.workspace_subscriptions
  for select to authenticated using (
    owner_user_id = auth.uid()
    or exists (select 1 from public.workspaces w where w.subscription_id = workspace_subscriptions.id and public.is_workspace_member(w.id))
  );
revoke all on public.workspace_subscriptions from anon, authenticated;
grant select on public.workspace_subscriptions to authenticated;

-- Members cannot attach a workspace to another subscription; only billing paths may.
create or replace function private.guard_workspace_billing()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- A deleted subscription detaches its workspaces through the foreign key; that is allowed.
  if tg_op = 'UPDATE' and new.subscription_id is null and old.subscription_id is not null
     and not exists (select 1 from public.workspace_subscriptions s where s.id = old.subscription_id) then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.subscription_id is not null or tg_op = 'UPDATE' and new.subscription_id is distinct from old.subscription_id)
     and coalesce(current_setting('hilm.billing_write', true), '') <> '1' then
    raise exception 'workspace_billing_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_workspace_billing() from public, anon, authenticated;
drop trigger if exists workspaces_guard_billing on public.workspaces;
create trigger workspaces_guard_billing before insert or update of subscription_id on public.workspaces
  for each row execute function private.guard_workspace_billing();

-- The only path that re-links a workspace to a subscription (admin console).
create or replace function private.attach_workspace_subscription(p_workspace_id uuid, p_subscription_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_rows integer;
begin
  perform set_config('hilm.billing_write', '1', true);
  update public.workspaces set subscription_id = p_subscription_id where id = p_workspace_id;
  get diagnostics v_rows = row_count;
  perform set_config('hilm.billing_write', '', true);
  return v_rows > 0;
end;
$$;
revoke all on function private.attach_workspace_subscription(uuid, uuid) from public, anon, authenticated;

-- Effective entitlement of a workspace: active (full), grace (full, renewal pending), restricted
-- (read-only, no AI) or none (no subscription; read-only). Data is never deleted.
create or replace function private.workspace_entitlement(p_workspace_id uuid)
returns table (
  subscription_id uuid,
  plan_id text,
  subscription_status text,
  effective_status text,
  grace_until timestamptz,
  billing_owner uuid
)
language sql
stable
security definer
set search_path = public, private
as $$
  select s.id, s.plan_id, s.status,
    case
      when s.id is null then 'none'
      when s.status in ('active', 'trialing', 'comped') and (s.current_period_end is null or s.current_period_end > now()) then 'active'
      when s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now() then 'active'
      when now() < coalesce(s.current_period_end, s.status_changed_at) + make_interval(days => s.grace_days) then 'grace'
      else 'restricted'
    end,
    case when s.id is null then null
      else coalesce(s.current_period_end, s.status_changed_at) + make_interval(days => s.grace_days) end,
    s.owner_user_id
  from public.workspaces w
  left join public.workspace_subscriptions s on s.id = w.subscription_id
  where w.id = p_workspace_id
$$;
revoke all on function private.workspace_entitlement(uuid) from public, anon, authenticated;

create or replace function private.subscription_is_usable(p_subscription_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.workspace_subscriptions s
    where s.id = p_subscription_id
      and ((s.status in ('active', 'trialing', 'comped') and (s.current_period_end is null or s.current_period_end > now()))
        or (s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now()))
  )
$$;
revoke all on function private.subscription_is_usable(uuid) from public, anon, authenticated;

create or replace function private.workspace_is_writable(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((select e.effective_status in ('active', 'grace') from private.workspace_entitlement(p_workspace_id) e), false)
$$;
revoke all on function private.workspace_is_writable(uuid) from public, anon, authenticated;

-- Content writes stop (read-only) when the workspace subscription lapses past its grace period.
create or replace function public.can_edit_workspace_content(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(public.workspace_member_role(ws_id) in ('owner', 'admin', 'member'), false)
     and private.workspace_is_writable(ws_id);
$$;

-- Existing workspaces predate billing: each keeps working on its own complimentary Team
-- subscription (one workspace each, so no new workspace capacity is granted).
do $$
declare
  v_ws record;
  v_sub uuid;
begin
  perform set_config('hilm.billing_write', '1', true);
  for v_ws in select id, owner_id from public.workspaces where subscription_id is null order by created_at loop
    insert into public.workspace_subscriptions (owner_user_id, plan_id, status, provider, notes)
    values (v_ws.owner_id, 'team', 'comped', 'manual', 'Legacy workspace created before Workspace OS billing; complimentary until reviewed.')
    returning id into v_sub;
    update public.workspaces set subscription_id = v_sub where id = v_ws.id;
  end loop;
  perform set_config('hilm.billing_write', '', true);
end $$;

-- ── Workspace creation and project limits ─────────────────────────────────────────────────────
create or replace function public.create_workspace(p_name text, p_description text default null, p_color text default '#60a5fa')
returns public.workspaces
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  uid uuid := auth.uid();
  ws public.workspaces;
  base_slug text;
  final_slug text;
  n int := 0;
  tkey text;
  v_sub uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if length(trim(p_name)) < 2 then
    raise exception 'Workspace name is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hilm.workspace_create:' || uid::text, 0));

  select s.id into v_sub
  from public.workspace_subscriptions s
  join public.ai_quota_tiers t on t.id = s.plan_id
  where s.owner_user_id = uid
    and private.subscription_is_usable(s.id)
    and (select count(*) from public.workspaces w where w.subscription_id = s.id) < coalesce(t.max_workspaces, 0)
  order by t.max_workspaces desc, s.created_at
  limit 1;

  if v_sub is null then
    if exists (select 1 from public.workspace_subscriptions s where s.owner_user_id = uid and private.subscription_is_usable(s.id)) then
      raise exception 'workspace_limit_reached' using errcode = 'P0001',
        hint = 'Your workspace plan has no free workspace slot. Team Pro allows up to 3 workspaces.';
    end if;
    raise exception 'workspace_plan_required' using errcode = 'P0001',
      hint = 'Creating a workspace requires a Team or Team Pro subscription.';
  end if;

  base_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then
    base_slug := 'workspace';
  end if;
  final_slug := base_slug;
  while exists (select 1 from public.workspaces where slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n::text;
  end loop;

  tkey := public.derive_workspace_task_key(trim(p_name), final_slug);

  perform set_config('hilm.billing_write', '1', true);
  insert into public.workspaces (name, slug, task_key, description, color, invite_code, owner_id, subscription_id)
  values (trim(p_name), final_slug, tkey, p_description, coalesce(nullif(p_color, ''), '#60a5fa'),
    public.generate_workspace_invite_code(), uid, v_sub)
  returning * into ws;
  perform set_config('hilm.billing_write', '', true);

  insert into public.workspace_members (workspace_id, user_id, role) values (ws.id, uid, 'owner');
  insert into public.workspace_task_counters (workspace_id, last_number) values (ws.id, 0) on conflict (workspace_id) do nothing;
  insert into public.workspace_activity_events (workspace_id, actor_id, event_type, entity_type, entity_id, summary)
  values (ws.id, uid, 'workspace.created', 'workspace', ws.id, 'Workspace created');

  return ws;
end;
$function$;

create or replace function private.enforce_workspace_project_limit()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.status = 'archived' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'archived' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hilm.workspace_projects:' || new.workspace_id::text, 0));
  select t.max_projects_per_workspace into v_limit
  from private.workspace_entitlement(new.workspace_id) e
  join public.ai_quota_tiers t on t.id = e.plan_id;
  if v_limit is null then
    return new;
  end if;
  select count(*) into v_count from public.workspace_projects
  where workspace_id = new.workspace_id and status <> 'archived' and id <> new.id;
  if v_count >= v_limit then
    raise exception 'workspace_project_limit' using errcode = 'P0001',
      hint = format('This workspace plan allows %s active projects.', v_limit);
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_workspace_project_limit() from public, anon, authenticated;
drop trigger if exists workspace_projects_plan_limit on public.workspace_projects;
create trigger workspace_projects_plan_limit before insert or update of status on public.workspace_projects
  for each row execute function private.enforce_workspace_project_limit();

-- Workspace storage: an admin override first, then the workspace plan, then the platform default.
create or replace function private.storage_quota_for(p_scope text, p_workspace_id uuid, p_owner uuid)
returns table (quota_bytes bigint, used_bytes bigint)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    coalesce(
      (select o.max_bytes from public.storage_quota_overrides o
       where o.scope_type = case when p_scope = 'workspace' then 'workspace' else 'user' end
         and o.scope_id = case when p_scope = 'workspace' then p_workspace_id else p_owner end),
      case when p_scope = 'workspace' then
        (select t.storage_quota_bytes from private.workspace_entitlement(p_workspace_id) e
         join public.ai_quota_tiers t on t.id = e.plan_id where e.effective_status in ('active', 'grace'))
      end,
      (select case when p_scope = 'workspace' then s.default_workspace_quota_bytes else s.default_user_quota_bytes end
       from private.storage_lifecycle_settings s)
    ),
    coalesce(
      (select sum(u.bytes_active + u.bytes_pending)::bigint from public.storage_usage u
       where u.scope_type = case when p_scope = 'workspace' then 'workspace' else 'user' end
         and u.scope_id = case when p_scope = 'workspace' then p_workspace_id else p_owner end
         and u.category = 'task_attachment'),
      0
    );
$$;

-- ── Usage ledger: explicit scope on every AI event ────────────────────────────────────────────
alter table public.ai_usage_events
  add column if not exists scope text,
  add column if not exists plan_id text,
  add column if not exists subscription_id uuid,
  add column if not exists reserved_tokens integer not null default 0;

update public.ai_usage_events set scope = case when workspace_id is null then 'personal' else 'workspace' end where scope is null;
alter table public.ai_usage_events alter column scope set default 'personal';
alter table public.ai_usage_events alter column scope set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_usage_events_scope_check') then
    alter table public.ai_usage_events add constraint ai_usage_events_scope_check
      check ((scope = 'personal' and workspace_id is null) or (scope = 'workspace' and workspace_id is not null));
  end if;
  alter table public.ai_usage_events drop constraint if exists ai_usage_events_status_check;
  alter table public.ai_usage_events add constraint ai_usage_events_status_check
    check (status in ('started', 'completed', 'failed', 'rejected', 'duplicate', 'reversed'));
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_events' and column_name = 'billing_period') then
    alter table public.ai_usage_events add column billing_period date
      generated always as ((date_trunc('month', created_at at time zone 'UTC'))::date) stored;
  end if;
end $$;

create index if not exists ai_usage_events_personal_idx on public.ai_usage_events (user_id, created_at desc) where scope = 'personal';
create index if not exists ai_usage_events_workspace_scope_idx on public.ai_usage_events (workspace_id, created_at desc) where scope = 'workspace';
create index if not exists ai_usage_events_period_idx on public.ai_usage_events (billing_period, scope);

drop function if exists public.begin_ai_request(text, text, uuid, uuid, text, text, uuid);

create function public.begin_ai_request(
  p_request_kind text,
  p_model text default null,
  p_workspace_id uuid default null,
  p_conversation_id uuid default null,
  p_idempotency_key text default null,
  p_fingerprint text default null,
  p_user_id uuid default null,
  p_scope text default null,
  p_reserve_tokens integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_user_id uuid;
  v_scope text;
  v_ws uuid;
  v_tier public.ai_quota_tiers%rowtype;
  v_ent record;
  v_sub uuid;
  v_event public.ai_usage_events%rowtype;
  v_existing public.ai_usage_events%rowtype;
  v_lock public.ai_request_locks%rowtype;
  v_minute_count integer := 0;
  v_member_day integer := 0;
  v_day_count integer := 0;
  v_month_count integer := 0;
  v_day_tokens bigint := 0;
  v_month_tokens bigint := 0;
  v_inflight bigint := 0;
  v_day_cost numeric := 0;
  v_month_cost numeric := 0;
  v_concurrent integer := 0;
  v_global_cap numeric;
  v_global_cost numeric := 0;
  v_is_meeting boolean := p_request_kind in ('meeting_transcribe', 'meeting_analyze', 'meeting_translate');
  v_token_metered boolean := p_request_kind <> 'meeting_transcribe';
  v_reserve integer;
  v_max_concurrent integer;
  v_now timestamptz := now();
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_error_code text;
  v_error_message text;
  v_fingerprint text;
  v_ttl interval := case when p_request_kind in ('meeting_transcribe', 'meeting_analyze', 'meeting_translate')
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

  -- The caller states where the work happens. A workspace id without a scope is read as a
  -- workspace request; a workspace request is never re-routed to personal accounting.
  v_scope := lower(coalesce(nullif(trim(p_scope), ''), case when p_workspace_id is null then 'personal' else 'workspace' end));
  if v_scope not in ('personal', 'workspace') then
    raise exception 'invalid_scope';
  end if;
  if v_scope = 'personal' and p_workspace_id is not null then
    return jsonb_build_object('ok', false, 'code', 'scope_mismatch', 'scope', v_scope,
      'message', 'A personal AI request cannot be charged to a workspace.');
  end if;
  if v_scope = 'workspace' then
    if p_workspace_id is null then
      return jsonb_build_object('ok', false, 'code', 'workspace_required', 'scope', v_scope,
        'message', 'This AI request needs its workspace.');
    end if;
    if not exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = v_user_id) then
      return jsonb_build_object('ok', false, 'code', 'not_workspace_member', 'scope', v_scope,
        'message', 'You are not a member of this workspace.');
    end if;
    v_ws := p_workspace_id;
  end if;

  -- One quota decision at a time per accounting pool.
  perform pg_advisory_xact_lock(hashtextextended(
    case when v_scope = 'workspace' then 'hilm.ai_quota.ws:' || v_ws::text else 'hilm.ai_quota:' || v_user_id::text end, 0));

  delete from public.ai_request_locks where user_id = v_user_id and expires_at < v_now;

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select * into v_existing from public.ai_usage_events
    where user_id = v_user_id and idempotency_key = trim(p_idempotency_key)
    limit 1;
    if found then
      if v_existing.status = 'completed' then
        return jsonb_build_object('ok', false, 'code', 'duplicate', 'scope', v_existing.scope,
          'message', 'This AI request was already completed.', 'event_id', v_existing.id, 'status', v_existing.status);
      end if;
      if v_existing.status = 'started' and v_existing.created_at > v_now - v_ttl then
        return jsonb_build_object('ok', false, 'code', 'in_flight', 'scope', v_existing.scope,
          'message', 'This AI request is already running. Please wait.', 'event_id', v_existing.id, 'status', v_existing.status);
      end if;
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
    select * into v_lock from public.ai_request_locks
    where user_id = v_user_id and fingerprint = v_fingerprint and expires_at > v_now
    limit 1;
    if found then
      return jsonb_build_object('ok', false, 'code', 'duplicate_execution', 'scope', v_scope,
        'message', 'An identical AI request is already in progress.', 'event_id', v_lock.usage_event_id);
    end if;
  end if;

  if v_scope = 'workspace' then
    select * into v_ent from private.workspace_entitlement(v_ws);
    if v_ent.effective_status not in ('active', 'grace') then
      return jsonb_build_object('ok', false, 'code', 'workspace_subscription_inactive', 'scope', v_scope,
        'workspace_id', v_ws,
        'message', 'This workspace''s subscription is not active. Ask the workspace owner to renew it.');
    end if;
    select * into v_tier from public.ai_quota_tiers where id = v_ent.plan_id;
    v_sub := v_ent.subscription_id;
  else
    select t.* into v_tier from public.profiles p
    join public.ai_quota_tiers t on t.id = p.ai_tier_id and t.scope = 'personal'
    where p.id = v_user_id limit 1;
    if not found then
      select * into v_tier from public.ai_quota_tiers where id = 'free' limit 1;
    end if;
  end if;

  if not coalesce(v_tier.enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'tier_disabled', 'scope', v_scope,
      'message', 'AI access is disabled for this plan. Contact support.');
  end if;

  v_reserve := case when v_token_metered then greatest(0, coalesce(p_reserve_tokens,
    case p_request_kind when 'chat' then 3000 when 'daily_log' then 2000 when 'meeting_analyze' then 12000
      when 'meeting_translate' then 6000 else 0 end)) else 0 end;

  if v_scope = 'workspace' then
    select
      count(*) filter (where user_id = v_user_id and request_kind in ('chat', 'daily_log') and status in ('started', 'completed') and created_at > v_now - interval '1 minute'),
      count(*) filter (where user_id = v_user_id and request_kind in ('chat', 'daily_log') and status in ('started', 'completed') and created_at >= v_day_start),
      count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed') and created_at >= v_day_start),
      count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed')),
      coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe' and status in ('completed', 'failed') and created_at >= v_day_start), 0),
      coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe' and status in ('completed', 'failed')), 0),
      coalesce(sum(reserved_tokens) filter (where status = 'started' and created_at > v_now - v_ttl), 0),
      coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed') and created_at >= v_day_start), 0),
      coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed')), 0)
    into v_minute_count, v_member_day, v_day_count, v_month_count, v_day_tokens, v_month_tokens, v_inflight, v_day_cost, v_month_cost
    from public.ai_usage_events
    where workspace_id = v_ws and scope = 'workspace' and created_at >= v_month_start;
  else
    select
      count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed') and created_at > v_now - interval '1 minute'),
      count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed') and created_at >= v_day_start),
      count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed')),
      coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe' and status in ('completed', 'failed') and created_at >= v_day_start), 0),
      coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe' and status in ('completed', 'failed')), 0),
      coalesce(sum(reserved_tokens) filter (where status = 'started' and created_at > v_now - v_ttl), 0),
      coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed') and created_at >= v_day_start), 0),
      coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed')), 0)
    into v_minute_count, v_day_count, v_month_count, v_day_tokens, v_month_tokens, v_inflight, v_day_cost, v_month_cost
    from public.ai_usage_events
    where user_id = v_user_id and scope = 'personal' and created_at >= v_month_start;
  end if;

  select max_global_daily_cost_usd into v_global_cap from public.ai_runtime_controls where id = 'global';
  if coalesce(v_global_cap, 0) <= 0 then
    v_global_cap := private.ai_default_global_daily_cap();
  end if;
  if coalesce(v_global_cap, 0) > 0 then
    select coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)), 0) into v_global_cost
    from public.ai_usage_events where created_at >= v_day_start and status in ('completed', 'failed');
  end if;

  select count(*) into v_concurrent
  from public.ai_request_locks l
  left join public.ai_usage_events e on e.id = l.usage_event_id
  where l.user_id = v_user_id
    and l.expires_at > v_now
    and coalesce(e.scope, 'personal') = v_scope
    and (v_scope = 'personal' or e.workspace_id = v_ws)
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
  elsif v_scope = 'workspace' and not v_is_meeting and v_tier.member_requests_per_day is not null
        and v_member_day >= v_tier.member_requests_per_day then
    v_error_code := 'member_daily_limit';
    v_error_message := 'You reached your fair-use share of this workspace''s daily AI requests. It resets at midnight UTC.';
  elsif not v_is_meeting and v_day_count >= v_tier.requests_per_day then
    v_error_code := 'daily_request_limit';
    v_error_message := case when v_scope = 'workspace'
      then 'This workspace has used its daily AI requests. It resets at midnight UTC.'
      else 'You have reached your daily AI request limit. It resets at midnight UTC.' end;
  elsif not v_is_meeting and v_month_count >= v_tier.requests_per_month then
    v_error_code := 'monthly_request_limit';
    v_error_message := case when v_scope = 'workspace'
      then 'This workspace has used its monthly AI requests.' else 'You have reached your monthly AI request limit.' end;
  elsif v_token_metered and v_day_tokens + v_inflight >= v_tier.tokens_per_day then
    v_error_code := 'daily_token_limit';
    v_error_message := case when v_scope = 'workspace'
      then 'This workspace has used its daily AI allowance.' else 'You have reached your daily AI token quota.' end;
  elsif v_token_metered and v_month_tokens + v_inflight >= v_tier.tokens_per_month then
    v_error_code := 'monthly_token_limit';
    v_error_message := case when v_scope = 'workspace'
      then 'This workspace has used its monthly AI allowance.' else 'You have reached your monthly AI token quota.' end;
  elsif v_day_cost >= v_tier.cost_usd_per_day then
    v_error_code := 'daily_cost_limit';
    v_error_message := case when v_scope = 'workspace'
      then 'This workspace has reached its daily AI spend limit.' else 'You have reached your daily AI spend limit.' end;
  elsif v_month_cost >= v_tier.cost_usd_per_month then
    v_error_code := 'monthly_cost_limit';
    v_error_message := case when v_scope = 'workspace'
      then 'This workspace has reached its monthly AI spend limit.' else 'You have reached your monthly AI spend limit.' end;
  elsif v_concurrent >= v_max_concurrent then
    v_error_code := 'concurrent_limit';
    v_error_message := 'Another AI request is already running. Please wait for it to finish.';
  end if;

  if v_error_code is not null then
    insert into public.ai_usage_events (
      user_id, workspace_id, scope, plan_id, subscription_id, request_kind, model, status,
      error_code, error_message, idempotency_key, conversation_id, completed_at
    ) values (
      v_user_id, v_ws, v_scope, v_tier.id, v_sub, p_request_kind, p_model, 'rejected',
      v_error_code, v_error_message, null, p_conversation_id, v_now
    ) returning * into v_event;

    -- Owners and admins hear about an exhausted workspace allowance once a day per limit.
    if v_scope = 'workspace' and v_error_code in ('daily_request_limit', 'monthly_request_limit', 'daily_token_limit',
         'monthly_token_limit', 'daily_cost_limit', 'monthly_cost_limit') then
      begin
        insert into public.notifications (user_id, channel, type, title, body, entity_type, entity_id, href, metadata)
        select m.user_id, 'in_app', 'workspace.ai_limit', 'Workspace AI allowance reached', v_error_message,
          'workspace', v_ws, format('/workspace/%s/settings', v_ws),
          jsonb_build_object('workspace_id', v_ws, 'code', v_error_code, 'plan', v_tier.id)
        from public.workspace_members m
        where m.workspace_id = v_ws and m.role in ('owner', 'admin')
          and not exists (
            select 1 from public.notifications n
            where n.user_id = m.user_id and n.type = 'workspace.ai_limit' and n.entity_id = v_ws
              and n.metadata ->> 'code' = v_error_code and n.created_at >= v_day_start
          );
      exception when others then
        raise warning 'workspace ai limit notification failed: %', sqlstate;
      end;
    end if;

    return jsonb_build_object(
      'ok', false, 'code', v_error_code, 'message', v_error_message, 'event_id', v_event.id,
      'scope', v_scope, 'workspace_id', v_ws, 'tier', v_tier.id, 'plan', v_tier.id,
      'usage', jsonb_build_object(
        'requests_minute', v_minute_count, 'requests_day', v_day_count, 'requests_month', v_month_count,
        'member_requests_day', v_member_day, 'tokens_day', v_day_tokens, 'tokens_month', v_month_tokens,
        'tokens_reserved', v_inflight, 'cost_day', v_day_cost, 'cost_month', v_month_cost, 'concurrent', v_concurrent),
      'limits', jsonb_build_object(
        'requests_per_minute', v_tier.requests_per_minute, 'requests_per_day', v_tier.requests_per_day,
        'requests_per_month', v_tier.requests_per_month, 'member_requests_per_day', v_tier.member_requests_per_day,
        'tokens_per_day', v_tier.tokens_per_day, 'tokens_per_month', v_tier.tokens_per_month,
        'cost_usd_per_day', v_tier.cost_usd_per_day, 'cost_usd_per_month', v_tier.cost_usd_per_month,
        'max_concurrent', v_tier.max_concurrent)
    );
  end if;

  begin
    insert into public.ai_usage_events (
      user_id, workspace_id, scope, plan_id, subscription_id, request_kind, model, status,
      idempotency_key, conversation_id, reserved_tokens
    ) values (
      v_user_id, v_ws, v_scope, v_tier.id, v_sub, p_request_kind, p_model, 'started',
      nullif(trim(coalesce(p_idempotency_key, '')), ''), p_conversation_id, v_reserve
    ) returning * into v_event;
  exception
    when unique_violation then
      select * into v_existing from public.ai_usage_events
      where user_id = v_user_id and idempotency_key = trim(p_idempotency_key) limit 1;
      return jsonb_build_object('ok', false, 'code', 'duplicate', 'scope', v_scope,
        'message', 'This AI request was already submitted.', 'event_id', v_existing.id,
        'status', coalesce(v_existing.status, 'duplicate'));
  end;

  if v_fingerprint is not null then
    begin
      insert into public.ai_request_locks (user_id, fingerprint, usage_event_id, expires_at)
      values (v_user_id, v_fingerprint, v_event.id, v_now + v_ttl);
    exception
      when unique_violation then
        update public.ai_usage_events
        set status = 'rejected', error_code = 'duplicate_execution',
            error_message = 'An identical AI request is already in progress.', completed_at = v_now, idempotency_key = null
        where id = v_event.id;
        return jsonb_build_object('ok', false, 'code', 'duplicate_execution', 'scope', v_scope,
          'message', 'An identical AI request is already in progress.', 'event_id', v_event.id);
    end;
  else
    insert into public.ai_request_locks (user_id, fingerprint, usage_event_id, expires_at)
    values (v_user_id, 'event:' || v_event.id::text, v_event.id, v_now + v_ttl);
  end if;

  return jsonb_build_object(
    'ok', true, 'event_id', v_event.id, 'scope', v_scope, 'workspace_id', v_ws, 'tier', v_tier.id, 'plan', v_tier.id,
    'usage', jsonb_build_object(
      'requests_minute', v_minute_count, 'requests_day', v_day_count, 'requests_month', v_month_count,
      'member_requests_day', v_member_day, 'tokens_day', v_day_tokens, 'tokens_month', v_month_tokens,
      'tokens_reserved', v_inflight, 'cost_day', v_day_cost, 'cost_month', v_month_cost, 'concurrent', v_concurrent),
    'limits', jsonb_build_object(
      'requests_per_minute', v_tier.requests_per_minute, 'requests_per_day', v_tier.requests_per_day,
      'requests_per_month', v_tier.requests_per_month, 'member_requests_per_day', v_tier.member_requests_per_day,
      'tokens_per_day', v_tier.tokens_per_day, 'tokens_per_month', v_tier.tokens_per_month,
      'cost_usd_per_day', v_tier.cost_usd_per_day, 'cost_usd_per_month', v_tier.cost_usd_per_month,
      'max_concurrent', v_tier.max_concurrent)
  );
end;
$$;

revoke all on function public.begin_ai_request(text, text, uuid, uuid, text, text, uuid, text, integer) from public, anon;
grant execute on function public.begin_ai_request(text, text, uuid, uuid, text, text, uuid, text, integer) to authenticated, service_role;

-- ── Personal usage summary: personal scope only ──────────────────────────────────────────────
create or replace function private.meeting_minutes_used_ms(p_user_id uuid, p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(duration_ms), 0)::bigint
  from public.meeting_minutes_ledger
  where user_id = p_user_id and os = 'personal' and created_at >= p_since
$$;

create or replace function private.workspace_meeting_minutes_used_ms(p_workspace_id uuid, p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(duration_ms), 0)::bigint
  from public.meeting_minutes_ledger
  where workspace_id = p_workspace_id and os = 'workspace' and created_at >= p_since
$$;
revoke all on function private.workspace_meeting_minutes_used_ms(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.get_ai_usage_summary(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $function$
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

  select t.* into v_tier from public.profiles p
  join public.ai_quota_tiers t on t.id = p.ai_tier_id and t.scope = 'personal'
  where p.id = v_user_id limit 1;
  if not found then
    select * into v_tier from public.ai_quota_tiers where id = 'free' limit 1;
  end if;

  select
    count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed') and created_at >= v_day_start),
    count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed')),
    coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe' and status in ('completed', 'failed') and created_at >= v_day_start), 0),
    coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe' and status in ('completed', 'failed')), 0),
    coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed') and created_at >= v_day_start), 0),
    coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed')), 0),
    count(*) filter (where status = 'failed' and created_at >= v_day_start)
  into v_day_count, v_month_count, v_day_tokens, v_month_tokens, v_day_cost, v_month_cost, v_failed_day
  from public.ai_usage_events
  where user_id = v_user_id and scope = 'personal' and created_at >= v_month_start;

  select coalesce(jsonb_object_agg(request_kind, stats), '{}'::jsonb)
  into v_by_feature
  from (
    select request_kind,
      jsonb_build_object(
        'requests_day', count(*) filter (where created_at >= v_day_start and status in ('started', 'completed')),
        'requests_month', count(*) filter (where status in ('started', 'completed')),
        'tokens_day', coalesce(sum(total_tokens) filter (where created_at >= v_day_start and status = 'completed'), 0),
        'tokens_month', coalesce(sum(total_tokens) filter (where status = 'completed'), 0),
        'cost_day', coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where created_at >= v_day_start and status in ('completed', 'failed')), 0),
        'cost_month', coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed')), 0),
        'failed_tokens_day', coalesce(sum(total_tokens) filter (where created_at >= v_day_start and status = 'failed'), 0),
        'audio_ms_month', coalesce(sum(audio_ms) filter (where status = 'completed'), 0)
      ) as stats
    from public.ai_usage_events
    where user_id = v_user_id and scope = 'personal' and created_at >= v_month_start
    group by request_kind
  ) feature_rows;

  v_meeting_ms := private.meeting_minutes_used_ms(v_user_id, v_month_start);

  return jsonb_build_object(
    'tier', v_tier.id,
    'tier_name', v_tier.display_name,
    'scope', 'personal',
    'price_sar_monthly', v_tier.price_sar_monthly,
    'tokens_scope', 'excludes_meeting_transcription',
    'usage', jsonb_build_object(
      'requests_day', v_day_count, 'requests_month', v_month_count, 'tokens_day', v_day_tokens,
      'tokens_month', v_month_tokens, 'cost_day', v_day_cost, 'cost_month', v_month_cost, 'failed_day', v_failed_day),
    'meeting', jsonb_build_object(
      'minutes_used_month', round(v_meeting_ms / 60000.0, 2),
      'minutes_limit_month', coalesce(v_tier.meeting_minutes_per_month, 60),
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
      'requests_per_minute', v_tier.requests_per_minute, 'requests_per_day', v_tier.requests_per_day,
      'requests_per_month', v_tier.requests_per_month, 'tokens_per_day', v_tier.tokens_per_day,
      'tokens_per_month', v_tier.tokens_per_month, 'cost_usd_per_day', v_tier.cost_usd_per_day,
      'cost_usd_per_month', v_tier.cost_usd_per_month, 'max_concurrent', v_tier.max_concurrent,
      'meeting_max_minutes', coalesce(v_tier.meeting_max_minutes, 60),
      'meeting_minutes_per_month', coalesce(v_tier.meeting_minutes_per_month, 60))
  );
end;
$function$;

-- ── Meeting minutes per scope ─────────────────────────────────────────────────────────────────
drop function if exists public.meeting_quota_status(uuid);
create function public.meeting_quota_status(p_user_id uuid default null, p_workspace_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $function$
declare
  v_user_id uuid;
  v_tier public.ai_quota_tiers%rowtype;
  v_ent record;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_used_ms bigint;
  v_enabled boolean;
begin
  if auth.uid() is not null then
    v_user_id := auth.uid();
  elsif coalesce(auth.jwt()->>'role', '') = 'service_role' and p_user_id is not null then
    v_user_id := p_user_id;
  else
    raise exception 'unauthorized';
  end if;

  if p_workspace_id is not null then
    if not exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = v_user_id) then
      return jsonb_build_object('scope', 'workspace', 'enabled', false, 'code', 'not_workspace_member');
    end if;
    select * into v_ent from private.workspace_entitlement(p_workspace_id);
    select * into v_tier from public.ai_quota_tiers where id = v_ent.plan_id;
    v_enabled := coalesce(v_tier.enabled, false) and v_ent.effective_status in ('active', 'grace');
    v_used_ms := private.workspace_meeting_minutes_used_ms(p_workspace_id, v_month_start);
  else
    select t.* into v_tier from public.profiles p
    join public.ai_quota_tiers t on t.id = p.ai_tier_id and t.scope = 'personal'
    where p.id = v_user_id limit 1;
    if not found then
      select * into v_tier from public.ai_quota_tiers where id = 'free' limit 1;
    end if;
    v_enabled := coalesce(v_tier.enabled, false);
    v_used_ms := private.meeting_minutes_used_ms(v_user_id, v_month_start);
  end if;

  return jsonb_build_object(
    'scope', case when p_workspace_id is null then 'personal' else 'workspace' end,
    'tier', v_tier.id,
    'enabled', v_enabled,
    'max_minutes', coalesce(v_tier.meeting_max_minutes, 0),
    'minutes_per_month', coalesce(v_tier.meeting_minutes_per_month, 0),
    'used_minutes_month', round(v_used_ms / 60000.0, 2),
    'used_ms_month', v_used_ms,
    'max_retries', coalesce(v_tier.meeting_max_retries, 3)
  );
end;
$function$;
revoke all on function public.meeting_quota_status(uuid, uuid) from public, anon;
grant execute on function public.meeting_quota_status(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_meeting_segment(p_os text, p_meeting_id uuid, p_idx integer, p_storage_path text, p_duration_ms integer, p_offset_ms integer, p_mime text DEFAULT 'audio/wav'::text, p_byte_size bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_quota jsonb;
  v_meeting_ms bigint;
  v_existing uuid;
  v_id uuid;
  v_ws uuid;
  v_status text;
  v_duration integer := greatest(coalesce(p_duration_ms, 0), 0);
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if p_idx is null or p_idx < 0 or p_idx > 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_segment');
  end if;

  if p_os = 'personal' then
    perform pg_advisory_xact_lock(hashtextextended('hilm.meeting_quota:' || v_uid::text, 0));
    select status into v_status from public.meetings
    where id = p_meeting_id and user_id = v_uid;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_storage_path not like (v_uid::text || '/' || p_meeting_id::text || '/%') then
      return jsonb_build_object('ok', false, 'code', 'invalid_path');
    end if;
    select id into v_existing from public.meeting_audio_segments
    where meeting_id = p_meeting_id and idx = p_idx;
    select coalesce(sum(duration_ms), 0) into v_meeting_ms
    from public.meeting_audio_segments where meeting_id = p_meeting_id;
  elsif p_os = 'workspace' then
    select status, workspace_id into v_status, v_ws from public.workspace_meetings
    where id = p_meeting_id;
    if not found or not public.can_edit_workspace_content(v_ws) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('hilm.meeting_quota.ws:' || v_ws::text, 0));
    if p_storage_path not like ('workspace/' || v_ws::text || '/' || p_meeting_id::text || '/%') then
      return jsonb_build_object('ok', false, 'code', 'invalid_path');
    end if;
    select id into v_existing from public.workspace_meeting_audio_segments
    where meeting_id = p_meeting_id and idx = p_idx;
    select coalesce(sum(duration_ms), 0) into v_meeting_ms
    from public.workspace_meeting_audio_segments where meeting_id = p_meeting_id;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_os');
  end if;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'segment_id', v_existing, 'duplicate', true);
  end if;

  v_quota := public.meeting_quota_status(null, v_ws);
  if not coalesce((v_quota->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'tier_disabled',
      'message', 'Meetings are not available on this plan right now.');
  end if;
  if v_meeting_ms + v_duration > ((v_quota->>'max_minutes')::numeric * 60000) + 60000 then
    return jsonb_build_object('ok', false, 'code', 'meeting_too_long',
      'message', 'This meeting reached the maximum recording length for your plan.');
  end if;
  if (v_quota->>'used_ms_month')::bigint >= (v_quota->>'minutes_per_month')::numeric * 60000
     or (v_quota->>'used_ms_month')::bigint + v_duration > (v_quota->>'minutes_per_month')::numeric * 60000 + 15000 then
    return jsonb_build_object('ok', false, 'code', 'monthly_meeting_limit',
      'message', 'You reached your monthly meeting minutes.');
  end if;

  if p_os = 'personal' then
    insert into public.meeting_audio_segments (
      user_id, meeting_id, idx, storage_path, duration_ms, offset_ms, mime, byte_size
    ) values (
      v_uid, p_meeting_id, p_idx, p_storage_path, v_duration,
      greatest(coalesce(p_offset_ms, 0), 0), p_mime, p_byte_size
    )
    on conflict (meeting_id, idx) do nothing
    returning id into v_id;
    if v_status = 'draft' then
      update public.meetings set status = 'recording', started_at = coalesce(started_at, now())
      where id = p_meeting_id;
    elsif v_status in ('ready', 'failed') then
      update public.meetings set status = 'processing', processing_error = null
      where id = p_meeting_id;
    end if;
  else
    insert into public.workspace_meeting_audio_segments (
      workspace_id, meeting_id, uploaded_by, idx, storage_path, duration_ms, offset_ms, mime, byte_size
    ) values (
      v_ws, p_meeting_id, v_uid, p_idx, p_storage_path, v_duration,
      greatest(coalesce(p_offset_ms, 0), 0), p_mime, p_byte_size
    )
    on conflict (meeting_id, idx) do nothing
    returning id into v_id;
    if v_status = 'draft' then
      update public.workspace_meetings set status = 'recording', started_at = coalesce(started_at, now())
      where id = p_meeting_id;
    elsif v_status in ('ready', 'failed') then
      update public.workspace_meetings set status = 'processing', processing_error = null
      where id = p_meeting_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'segment_id', v_id);
end;
$function$;

-- ── Plan views for the app ────────────────────────────────────────────────────────────────────
create or replace function private.plan_json(p_plan public.ai_quota_tiers)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p_plan.id, 'name', p_plan.display_name, 'scope', p_plan.scope,
    'price_sar_monthly', p_plan.price_sar_monthly, 'price_sar_yearly', p_plan.price_sar_yearly,
    'max_workspaces', p_plan.max_workspaces, 'max_projects_per_workspace', p_plan.max_projects_per_workspace,
    'storage_quota_bytes', p_plan.storage_quota_bytes, 'requests_per_day', p_plan.requests_per_day,
    'requests_per_month', p_plan.requests_per_month, 'tokens_per_day', p_plan.tokens_per_day,
    'tokens_per_month', p_plan.tokens_per_month, 'cost_usd_per_month', p_plan.cost_usd_per_month,
    'member_requests_per_day', p_plan.member_requests_per_day,
    'meeting_minutes_per_month', p_plan.meeting_minutes_per_month, 'meeting_max_minutes', p_plan.meeting_max_minutes,
    'features', p_plan.features)
$$;

-- Public price list (also used by the website through the app's anon client).
create or replace function public.plan_catalog()
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(jsonb_agg(private.plan_json(t) order by t.sort_order), '[]'::jsonb)
  from public.ai_quota_tiers t
  where t.enabled and t.id in ('free', 'pro', 'team', 'team_pro')
$$;
revoke all on function public.plan_catalog() from public;
grant execute on function public.plan_catalog() to anon, authenticated;

create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.ai_quota_tiers (id),
  workspace_id uuid references public.workspaces (id) on delete set null,
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'canceled')),
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists subscription_requests_one_pending
  on public.subscription_requests (user_id, plan_id) where status = 'pending';
alter table public.subscription_requests enable row level security;
drop policy if exists subscription_requests_select_own on public.subscription_requests;
create policy subscription_requests_select_own on public.subscription_requests
  for select to authenticated using (user_id = auth.uid());
revoke all on public.subscription_requests from anon, authenticated;
grant select on public.subscription_requests to authenticated;

create or replace function public.request_plan_upgrade(p_plan_id text, p_workspace_id uuid default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_plan_id not in ('pro', 'team', 'team_pro') then
    return jsonb_build_object('ok', false, 'code', 'invalid_plan');
  end if;
  if p_workspace_id is not null and not public.can_manage_workspace(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if (select count(*) from public.subscription_requests where user_id = v_uid and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  insert into public.subscription_requests (user_id, plan_id, workspace_id, note)
  values (v_uid, p_plan_id, p_workspace_id, nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
  on conflict (user_id, plan_id) where status = 'pending' do update set note = excluded.note, workspace_id = excluded.workspace_id
  returning id into v_id;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;
revoke all on function public.request_plan_upgrade(text, uuid, text) from public, anon;
grant execute on function public.request_plan_upgrade(text, uuid, text) to authenticated;

-- Everything the caller's plan screens need: personal plan, owned workspace subscriptions and
-- whether a new workspace can be created.
create or replace function public.my_billing()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_personal public.ai_quota_tiers%rowtype;
  v_subs jsonb;
  v_can_create boolean;
  v_reason text;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select t.* into v_personal from public.profiles p
  join public.ai_quota_tiers t on t.id = p.ai_tier_id and t.scope = 'personal'
  where p.id = v_uid;
  if not found then
    select * into v_personal from public.ai_quota_tiers where id = 'free';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'plan', private.plan_json(t), 'status', s.status,
      'usable', private.subscription_is_usable(s.id),
      'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
      'workspaces_used', (select count(*) from public.workspaces w where w.subscription_id = s.id),
      'workspaces', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name)), '[]'::jsonb)
                     from public.workspaces w where w.subscription_id = s.id)
    ) order by s.created_at), '[]'::jsonb)
  into v_subs
  from public.workspace_subscriptions s join public.ai_quota_tiers t on t.id = s.plan_id
  where s.owner_user_id = v_uid;

  v_can_create := exists (
    select 1 from public.workspace_subscriptions s join public.ai_quota_tiers t on t.id = s.plan_id
    where s.owner_user_id = v_uid and private.subscription_is_usable(s.id)
      and (select count(*) from public.workspaces w where w.subscription_id = s.id) < coalesce(t.max_workspaces, 0));
  v_reason := case when v_can_create then null
    when exists (select 1 from public.workspace_subscriptions s where s.owner_user_id = v_uid and private.subscription_is_usable(s.id))
      then 'workspace_limit_reached' else 'workspace_plan_required' end;

  return jsonb_build_object(
    'personal', private.plan_json(v_personal),
    'workspace_subscriptions', v_subs,
    'can_create_workspace', v_can_create,
    'create_block_reason', v_reason,
    'pending_requests', (select coalesce(jsonb_agg(jsonb_build_object('plan_id', r.plan_id, 'created_at', r.created_at)), '[]'::jsonb)
                         from public.subscription_requests r where r.user_id = v_uid and r.status = 'pending')
  );
end;
$$;
revoke all on function public.my_billing() from public, anon;
grant execute on function public.my_billing() to authenticated;

-- Workspace usage and plan for its settings page. Members see plan, status and pooled usage;
-- spend and storage detail are shown to owners and admins.
create or replace function public.workspace_usage_summary(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_manage boolean;
  v_ent record;
  v_tier public.ai_quota_tiers%rowtype;
  v_result jsonb;
  v_quota bigint;
  v_used bigint;
begin
  if auth.uid() is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  v_manage := coalesce(public.can_manage_workspace(p_workspace_id), false);
  select * into v_ent from private.workspace_entitlement(p_workspace_id);
  select * into v_tier from public.ai_quota_tiers where id = v_ent.plan_id;

  v_result := jsonb_build_object(
    'ok', true,
    'can_see_costs', v_manage,
    'is_billing_owner', v_ent.billing_owner = auth.uid(),
    'plan', case when v_tier.id is null then null else private.plan_json(v_tier) end,
    'subscription', jsonb_build_object(
      'status', v_ent.subscription_status, 'effective_status', v_ent.effective_status, 'grace_until', v_ent.grace_until),
    'members', (select count(*) from public.workspace_members where workspace_id = p_workspace_id),
    'projects', (select count(*) from public.workspace_projects where workspace_id = p_workspace_id and status <> 'archived'),
    'tasks_open', (select count(*) from public.workspace_tasks where workspace_id = p_workspace_id and status not in ('done', 'archived')),
    'tasks_done', (select count(*) from public.workspace_tasks where workspace_id = p_workspace_id and status = 'done'),
    'meetings', (select count(*) from public.workspace_meetings where workspace_id = p_workspace_id),
    'meeting_minutes_month', round(private.workspace_meeting_minutes_used_ms(p_workspace_id, v_month_start) / 60000.0, 1),
    'ai_pool', (
      select jsonb_build_object(
        'requests_day', count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed') and created_at >= v_day_start),
        'requests_month', count(*) filter (where request_kind in ('chat', 'daily_log') and status in ('started', 'completed')),
        'tokens_day', coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe' and status in ('completed', 'failed') and created_at >= v_day_start), 0),
        'tokens_month', coalesce(sum(total_tokens) filter (where request_kind <> 'meeting_transcribe' and status in ('completed', 'failed')), 0))
      from public.ai_usage_events
      where workspace_id = p_workspace_id and scope = 'workspace' and created_at >= v_month_start)
  );

  if v_manage then
    select q.quota_bytes, q.used_bytes into v_quota, v_used from private.storage_quota_for('workspace', p_workspace_id, null) q;
    v_result := v_result || jsonb_build_object(
      'storage', jsonb_build_object(
        'used_bytes', coalesce(v_used, 0),
        'quota_bytes', v_quota,
        'files', (select coalesce(sum(files_active), 0) from public.storage_usage where scope_type = 'workspace' and scope_id = p_workspace_id),
        'attachments_bytes', (select coalesce(sum(bytes_active), 0) from public.storage_usage
                              where scope_type = 'workspace' and scope_id = p_workspace_id and category = 'task_attachment'),
        'audio_bytes', (select coalesce(sum(bytes_active), 0) from public.storage_usage
                        where scope_type = 'workspace' and scope_id = p_workspace_id and category = 'meeting_audio')
      ),
      'ai_month', (
        select jsonb_build_object(
          'requests', count(*) filter (where status in ('started', 'completed') and request_kind in ('chat', 'daily_log')),
          'tokens', coalesce(sum(total_tokens) filter (where status in ('completed', 'failed') and request_kind <> 'meeting_transcribe'), 0),
          'meeting_requests', count(*) filter (where status in ('started', 'completed') and request_kind like 'meeting_%'),
          'cost_usd', round(coalesce(sum(coalesce(provider_cost_usd, estimated_cost_usd)) filter (where status in ('completed', 'failed')), 0), 4),
          'active_users', count(distinct user_id) filter (where status in ('started', 'completed'))
        )
        from public.ai_usage_events
        where workspace_id = p_workspace_id and scope = 'workspace' and created_at >= v_month_start
      )
    );
  end if;

  return v_result;
end;
$$;
