-- Align unsent reminder channels with live user settings
-- (push was often missing because channels were snapshotted before the toggle was saved).

update public.task_reminders r
set channels = (
  array['in_app']::public.notification_channel[]
  || case when coalesce(s.email_reminders_enabled, true)
      then array['email']::public.notification_channel[]
      else array[]::public.notification_channel[] end
  || case when coalesce(s.push_notifications_enabled, false)
      then array['push']::public.notification_channel[]
      else array[]::public.notification_channel[] end
)
from public.user_settings s
where s.user_id = r.user_id
  and r.notification_sent = false;
