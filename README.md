# Hilm

AI Personal Operating System — mobile-first Progressive Web App.

## Production

Live: [https://hillm.netlify.app](https://hillm.netlify.app)

### Notifications without a custom domain

Hilm uses **Web Push + in-app** reminders. That works on the Netlify HTTPS subdomain — you do **not** need to buy or verify a domain.

1. Set these **Netlify** env vars (Site configuration → Environment variables), then redeploy:

```bash
VITE_APP_URL=https://hillm.netlify.app
VITE_SUPABASE_URL=https://lrvmlayzmvswfqsqroni.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_VAPID_PUBLIC_KEY=BGYLY2fz4F9KL0ESWiM9a8d9z2gIkta06xruQo3qmNQZJ5h_aR6khrmIcSz1yr_HtLP4w4pcsdhJd6i6o5xe35I
VAPID_PUBLIC_KEY=BGYLY2fz4F9KL0ESWiM9a8d9z2gIkta06xruQo3qmNQZJ5h_aR6khrmIcSz1yr_HtLP4w4pcsdhJd6i6o5xe35I
VAPID_PRIVATE_KEY=...   # from .vapid.local — server only, never VITE_
VAPID_SUBJECT=mailto:noreply@hillm.netlify.app
DATABASE_URL=postgresql://...   # same as local .env — server only
CRON_SECRET=hilm-cron-change-me-in-prod
APP_URL=https://hillm.netlify.app
```

2. After deploy, enable **Settings → Push notifications** (Add to Home Screen recommended).

3. Reminder worker runs every minute via:
   - Netlify scheduled function `send-task-reminders`
   - Supabase `pg_cron` → HTTP POST to that function (backup)

Email (Resend) stays optional forever and is **not** required for reminders to work.

### Auth redirects

Supabase Auth → Site URL `https://hillm.netlify.app`  
Redirect: `https://hillm.netlify.app/auth/callback`

## Scripts

- `npm run dev` / `npm run build` / `npm run preview`
- `node scripts/print-push-secrets.mjs` — prints VAPID values for Netlify
