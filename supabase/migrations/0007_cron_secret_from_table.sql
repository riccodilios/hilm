-- Re-point cron at Netlify using CRON_SECRET from private.server_secrets
-- (avoids embedding secrets in migration source / Netlify secret scan).

do $$
begin
  perform cron.unschedule('hilm-send-task-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'hilm-send-task-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://hillm.netlify.app/.netlify/functions/send-task-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select value from private.server_secrets where key = 'CRON_SECRET' limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
