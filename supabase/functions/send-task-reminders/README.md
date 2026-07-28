# Cron: invoke send-task-reminders every minute
# Schedule this in Supabase Dashboard → Edge Functions → Schedules
# or via pg_cron + net.http_post with CRON_SECRET header.
#
# Required secrets:
#   APP_URL=https://your-production-domain
#   RESEND_API_KEY=...
#   RESEND_FROM_EMAIL=Hilm <noreply@yourdomain.com>
#   CRON_SECRET=long-random-string
#   OPENROUTER_API_KEY=...
#   OPENROUTER_DEFAULT_MODEL=google/gemini-2.5-flash
