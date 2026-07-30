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
DATABASE_URL=postgresql://...   # use Supabase **pooler** URL on Netlify (IPv4) — not db.*.supabase.co
CRON_SECRET=   # long random string — set via scripts/set-netlify-push-env.mjs
APP_URL=https://hillm.netlify.app
```

2. After deploy, enable **Settings → Push notifications** (Add to Home Screen recommended).

3. Reminder worker runs every minute via:
   - Netlify scheduled function `send-task-reminders`
   - Supabase `pg_cron` → HTTP POST to that function (backup)

Email (Resend) stays optional forever and is **not** required for reminders to work.

### Auth redirects

Never hardcode localhost in production.

1. **Netlify env:** `VITE_APP_URL=https://hillm.netlify.app`
2. **Local `.env`:** `VITE_APP_URL=http://localhost:5173`
3. **Supabase Auth → URL Configuration:**
   - Site URL (production): `https://hillm.netlify.app`
   - Redirect URLs:
     - `https://hillm.netlify.app/auth/callback**`
     - `https://hillm.netlify.app/auth/confirm**`
     - `http://localhost:5173/auth/callback**` (dev only)

Signup / resend / magic-link / password-reset all call `getAuthCallbackUrl()` which reads `VITE_APP_URL` (and falls back to `window.location.origin`, never emitting localhost while on a production host).

## Scripts

- `npm run dev` / `npm run build` / `npm run preview`
- `node scripts/print-push-secrets.mjs` — prints VAPID values for Netlify
