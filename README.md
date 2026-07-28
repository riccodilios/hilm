# Hilm

AI Personal Operating System — mobile-first Progressive Web App.

## Stack

React · TypeScript · Vite · Tailwind CSS · shadcn-style UI · React Router · Framer Motion · TanStack Query · Supabase · OpenRouter (via Edge Functions) · PWA · Web Push

## Production

Live site: [https://hillm.netlify.app](https://hillm.netlify.app)

### Netlify environment variables

```bash
VITE_APP_URL=https://hillm.netlify.app
VITE_SUPABASE_URL=https://lrvmlayzmvswfqsqroni.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
VITE_VAPID_PUBLIC_KEY=your-vapid-public-key
```

`NEXT_PUBLIC_*` aliases are also accepted.

### Push notifications (no custom domain)

Web Push works on the Netlify HTTPS subdomain. Users enable it in **Settings → Push notifications** (best after Add to Home Screen).

1. Generate keys: `npx web-push generate-vapid-keys`
2. Put the **public** key in Netlify as `VITE_VAPID_PUBLIC_KEY`
3. Put public + **private** keys in Supabase secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
4. Deploy `send-task-reminders` and schedule it every minute

### Email reminders

Code is ready. Set `RESEND_API_KEY` + `RESEND_FROM_EMAIL` on the edge function.  
Resend cannot verify `*.netlify.app` — use `onboarding@resend.dev` for testing, or verify any domain you own for production email to all users.

### Supabase Auth URL configuration

- **Site URL:** `https://hillm.netlify.app`
- **Redirect URLs:** `https://hillm.netlify.app/auth/callback`, `http://localhost:5173/auth/callback`

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Apply SQL migrations under [`supabase/migrations`](supabase/migrations).

## Scripts

- `npm run dev` — local development
- `npm run build` — production build
- `npm run preview` — preview production build
