-- Schedule reminder worker against the Netlify HTTPS app (no custom domain).
-- Uses Web Push + in-app only; email is optional and not required.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Unschedule previous job if present
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
      'x-cron-secret', 'hilm-cron-change-me-in-prod'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
