# Task reminders (email + Web Push + in-app)

## Deploy

```bash
supabase functions deploy send-task-reminders --project-ref lrvmlayzmvswfqsqroni
```

## Secrets

```bash
supabase secrets set \
  APP_URL=https://app.hilm.tech \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:you@example.com \
  CRON_SECRET=long-random-string \
  RESEND_API_KEY=... \
  RESEND_FROM_EMAIL="Hilm <onboarding@resend.dev>"
```

Notes:
- **Web Push** works on `https://app.hilm.tech` (and the original `hillm.netlify.app`).
- **Email** via Resend’s `onboarding@resend.dev` is for testing; production mail to all users needs a verified domain you control (not `*.netlify.app`).

## Schedule (every minute)

Supabase Dashboard → Edge Functions → `send-task-reminders` → Schedules → cron `* * * * *`

Or HTTP cron (Netlify function — requires CRON_SECRET; no public /api alias):

```bash
curl -X POST "https://hilm.tech/.netlify/functions/send-task-reminders" \
  -H "x-cron-secret: $CRON_SECRET"
```

Netlify's built-in schedule still runs this function every minute when `CRON_SECRET` is configured in Netlify env (and/or `private.server_secrets`).

## Netlify client env

```bash
VITE_APP_URL=https://app.hilm.tech
VITE_VAPID_PUBLIC_KEY=<same public key as VAPID_PUBLIC_KEY>
```
