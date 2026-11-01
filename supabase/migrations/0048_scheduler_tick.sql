-- Background work is triggered from the database instead of a per-minute Netlify schedule.
--
-- pg_cron runs private.scheduler_tick() every minute inside Postgres (no Netlify cost). It calls the
-- Netlify function scheduler-run through pg_net only when something is due: a task reminder in
-- the next minute, queued email, or a periodic job (storage lifecycle every 30 minutes, metrics
-- hourly). The Netlify function and its logic are unchanged; an hourly Netlify schedule remains
-- as a safety net. The secret lives in private.server_secrets (SCHEDULER_SECRET) and Netlify env.

insert into private.ops_collector_state (collector, interval_minutes) values ('tick', 1)
on conflict (collector) do nothing;
update private.ops_collector_state set interval_minutes = 30 where collector = 'lifecycle';

create or replace function private.scheduler_tick()
returns text
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_due boolean;
  v_secret text;
  v_url text;
begin
  update private.ops_collector_state set last_attempt_at = now(), last_success_at = now(), last_error = null
  where collector = 'tick';

  select
    exists (select 1 from public.task_reminders r
            where r.notification_sent = false and r.remind_at <= now() + interval '60 seconds'
              and (r.claimed_at is null or r.claimed_at < now() - interval '300 seconds'))
    or exists (select 1 from public.workspace_tasks t
               where t.reminder_at is not null and t.reminder_sent_at is null
                 and t.reminder_at <= now() + interval '60 seconds')
    or exists (select 1 from private.email_outbox o
               where (o.status = 'pending' and o.send_after <= now())
                  or (o.status = 'sending' and o.locked_at < now() - interval '10 minutes'))
    or exists (select 1 from private.ops_collector_state s
               where s.collector in ('lifecycle', 'metrics')
                 and (s.last_attempt_at is null
                      or s.last_attempt_at <= now() - make_interval(mins => s.interval_minutes) + interval '20 seconds'))
  into v_due;
  if not v_due then
    return 'idle';
  end if;

  select value into v_secret from private.server_secrets where key = 'SCHEDULER_SECRET';
  if v_secret is null then
    update private.ops_collector_state set last_error = 'SCHEDULER_SECRET missing' where collector = 'tick';
    return 'not_configured';
  end if;
  v_url := coalesce(
    (select value from private.server_secrets where key = 'SCHEDULER_URL'),
    'https://app.hilm.tech/api/scheduler-run'
  );
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 30000
  );
  return 'called';
end;
$$;
revoke all on function private.scheduler_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'hilm-scheduler-tick') then
    perform cron.unschedule('hilm-scheduler-tick');
  end if;
  if exists (select 1 from cron.job where jobname = 'hilm-cron-history-cleanup') then
    perform cron.unschedule('hilm-cron-history-cleanup');
  end if;
end $$;

select cron.schedule('hilm-scheduler-tick', '* * * * *', $$select private.scheduler_tick()$$);
-- pg_cron keeps a row per run (1,440 a day); keep three days.
select cron.schedule('hilm-cron-history-cleanup', '23 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);

insert into private.ops_alert_rules (key, metric, comparison, warn_value, crit_value, limit_key, cooldown_hours, description) values
  ('scheduler_tick_stale', 'ops.tick_age_minutes', 'gte', 5, 30, null, 6, 'Minutes since the database scheduler tick last ran (reminders depend on it)')
on conflict (key) do nothing;
update private.ops_alert_rules set warn_value = 90, crit_value = 180 where key = 'lifecycle_stale';
