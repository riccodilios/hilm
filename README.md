# Hilm

AI Personal Operating System — mobile-first Progressive Web App.

## Stack

React · TypeScript · Vite · Tailwind CSS · shadcn-style UI · React Router · Framer Motion · TanStack Query · Supabase · OpenRouter (via Edge Functions) · PWA

## Setup

1. Copy env file and fill in Supabase credentials:

```bash
cp .env.example .env
```

2. Create a Supabase project, then apply the migration in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) (SQL editor or Supabase CLI).

3. Deploy Edge Functions:

```bash
supabase functions deploy encrypt-key
supabase functions deploy ai-chat
```

Set function secrets:

```bash
supabase secrets set ENCRYPTION_SECRET=your-long-random-secret
```

4. Enable Email auth in Supabase (Authentication → Providers → Email).

5. Install and run:

```bash
npm install
npm run dev
```

6. Sign up, then either:
   - Put `OPENROUTER_API_KEY` in `.env` and set it as a Supabase Edge secret, **or**
   - Paste your OpenRouter key in **Settings** (BYOK)

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `VITE_SUPABASE_URL` | `.env` | `https://<project-ref>.supabase.co` (API URL, not Postgres) |
| `VITE_SUPABASE_ANON_KEY` | `.env` | Supabase anon/public key |
| `DATABASE_URL` | `.env` | Postgres URI for migrations/CLI only |
| `OPENROUTER_API_KEY` | `.env` + Edge secrets | OpenRouter key (never `VITE_` — not shipped to browser) |
| `OPENROUTER_DEFAULT_MODEL` | `.env` + Edge secrets | Default model id |

## Scripts

- `npm run dev` — local development
- `npm run build` — production build
- `npm run preview` — preview production build

## Architecture

- Feature-first folders under `src/features/`
- All LLM calls go through Supabase Edge Functions (BYOK encrypted at rest)
- Domain mutations share repositories; AI actions execute through the same paths
- TanStack Query + IndexedDB persistence for offline reads

## MVP surfaces

Home · Projects · Tasks / Kanban · Notes · Daily Log · Roadmap · Activity · AI Chat + Actions · Command Palette (⌘K) · Search · Settings · PWA
