# Task reminders — legacy Edge Function (push + in-app only)

Production reminders run in the Netlify function `netlify/functions/send-task-reminders.ts`
(scheduled every minute). It also queues the reminder **email** in `private.email_outbox`, which is
sent through Resend — see `docs/email.md`. This Edge Function no longer sends email so that a
redeploy can never duplicate it.

## Deploy (only if you need the Supabase-side fallback)

```bash
supabase functions deploy send-task-reminders --project-ref lrvmlayzmvswfqsqroni
```

## Secrets

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:you@example.com \
  CRON_SECRET=long-random-string
```

## Netlify client env

```bash
VITE_APP_URL=https://app.hilm.tech
VITE_VAPID_PUBLIC_KEY=<same public key as VAPID_PUBLIC_KEY>
```
