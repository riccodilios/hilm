# Task reminders (email + Web Push + in-app)

## Deploy

```bash
supabase functions deploy send-task-reminders --project-ref lrvmlayzmvswfqsqroni
```

## Secrets

```bash
supabase secrets set \
  APP_URL=https://hillm.netlify.app \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:you@example.com \
  CRON_SECRET=long-random-string \
  RESEND_API_KEY=... \
  RESEND_FROM_EMAIL="Hilm <onboarding@resend.dev>"
```

Notes:
- **Web Push** works on `https://hillm.netlify.app` with no custom domain.
- **Email** via Resend’s `onboarding@resend.dev` is for testing; production mail to all users needs a verified domain you control (not `*.netlify.app`).

## Schedule (every minute)

Supabase Dashboard → Edge Functions → `send-task-reminders` → Schedules → cron `* * * * *`

Or HTTP cron:

```bash
curl -X POST "https://lrvmlayzmvswfqsqroni.supabase.co/functions/v1/send-task-reminders" \
  -H "x-cron-secret: $CRON_SECRET"
```

## Netlify client env

```bash
VITE_APP_URL=https://hillm.netlify.app
VITE_VAPID_PUBLIC_KEY=<same public key as VAPID_PUBLIC_KEY>
```
