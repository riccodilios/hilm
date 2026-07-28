# Hilm

AI Personal Operating System — mobile-first Progressive Web App.

## Stack

React · TypeScript · Vite · Tailwind CSS · shadcn-style UI · React Router · Framer Motion · TanStack Query · Supabase · OpenRouter (via Edge Functions) · PWA

## Production

Live site: [https://hillm.netlify.app](https://hillm.netlify.app)

### Netlify environment variables

Set these in **Netlify → Site configuration → Environment variables** (then trigger a redeploy):

```bash
VITE_APP_URL=https://hillm.netlify.app
VITE_SUPABASE_URL=https://lrvmlayzmvswfqsqroni.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are also accepted.

### Supabase Auth URL configuration

Dashboard → Authentication → URL configuration:

- **Site URL:** `https://hillm.netlify.app`
- **Redirect URLs:**
  - `https://hillm.netlify.app/auth/callback`
  - `http://localhost:5173/auth/callback`

## Setup

1. Copy env file and fill credentials:

```bash
cp .env.example .env
```

Set `VITE_APP_URL` to your environment URL (dev/staging/prod). Never leave production pointing at localhost.

2. Apply SQL migrations in order under [`supabase/migrations`](supabase/migrations).

3. Deploy Edge Functions:

```bash
supabase functions deploy ai-chat
supabase functions deploy send-task-reminders
```

Secrets:

```bash
supabase secrets set APP_URL=https://hillm.netlify.app OPENROUTER_API_KEY=... OPENROUTER_DEFAULT_MODEL=google/gemini-2.5-flash RESEND_API_KEY=... RESEND_FROM_EMAIL="Hilm <noreply@yourdomain.com>" CRON_SECRET=...
```

4. Schedule reminders (every minute) to `POST /functions/v1/send-task-reminders` with header `x-cron-secret: $CRON_SECRET`.

5. Install and run:

```bash
npm install
npm run dev
```

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `VITE_APP_URL` | Netlify / `.env` | Canonical app URL for auth redirects + deep links |
| `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | Netlify / `.env` | Supabase API URL |
| `VITE_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Netlify / `.env` | Supabase anon/publishable key |
| `DATABASE_URL` | `.env` | Postgres URI (CLI/migrations only) |
| `OPENROUTER_API_KEY` | Edge secrets | LLM provider key |
| `OPENROUTER_DEFAULT_MODEL` | Edge secrets | Defaults to `google/gemini-2.5-flash` |
| `APP_URL` | Edge secrets | Same production URL used in reminder emails |
| `RESEND_API_KEY` | Edge secrets | Transactional email delivery |
| `CRON_SECRET` | Edge secrets | Protects reminder cron endpoint |

## Scripts

- `npm run dev` — local development
- `npm run build` — production build
- `npm run preview` — preview production build
