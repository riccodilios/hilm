# Hilm

AI Personal Operating System — mobile-first Progressive Web App.

## Stack

React · TypeScript · Vite · Tailwind CSS · shadcn-style UI · React Router · Framer Motion · TanStack Query · Supabase · OpenRouter (via Edge Functions) · PWA

## Setup

1. Copy env file and fill credentials:

```bash
cp .env.example .env
```

Set `VITE_APP_URL` to your environment URL (dev/staging/prod). Never leave production pointing at localhost.

2. Apply SQL migrations in order under [`supabase/migrations`](supabase/migrations).

3. Supabase Auth (Dashboard → Authentication → URL configuration):

- **Site URL:** your production `VITE_APP_URL`
- **Redirect URLs:**  
  - `http://localhost:5173/auth/callback` (dev)  
  - `https://your-domain/auth/callback` (prod)  
  - optional staging URL

4. Deploy Edge Functions:

```bash
supabase functions deploy ai-chat
supabase functions deploy send-task-reminders
```

Secrets:

```bash
supabase secrets set APP_URL=https://your-domain OPENROUTER_API_KEY=... OPENROUTER_DEFAULT_MODEL=google/gemini-2.5-flash RESEND_API_KEY=... RESEND_FROM_EMAIL="Hilm <noreply@yourdomain.com>" CRON_SECRET=...
```

5. Schedule reminders (every minute) to `POST /functions/v1/send-task-reminders` with header `x-cron-secret: $CRON_SECRET`.

6. Install and run:

```bash
npm install
npm run dev
```

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `VITE_APP_URL` | `.env` | Canonical app URL for auth redirects + deep links |
| `VITE_SUPABASE_URL` | `.env` | Supabase API URL |
| `VITE_SUPABASE_ANON_KEY` | `.env` | Supabase anon key |
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
