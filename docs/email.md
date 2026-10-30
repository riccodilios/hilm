# Transactional email (Resend)

Hilm sends app email through [Resend](https://resend.com) from the dedicated sending subdomain
**hilm.tech** (domain verified in Resend; bounces return via `send.hilm.tech`). The business mailbox `info@hilm.tech` (Amelu) is separate and is only used as
the Reply-To address, because the sending identities below cannot receive mail.

| Identity | Used for |
|---|---|
| `Hilm Notifications <notifications@hilm.tech>` | Task reminders (personal + workspace), assignments, mentions, task updates and comments |
| `Hilm Security <security@hilm.tech>` | Verification / password-reset / sign-in codes (Supabase hook), account deleted notice |
| `Hilm Team <team@hilm.tech>` | Workspace invitations, delivery tests |
| `Hilm <noreply@hilm.tech>` | Product news broadcasts (opt-out, one-click unsubscribe) |

## What is sent

| Email | Trigger | Preference |
|---|---|---|
| Verification code (+ button) | Sign-up, resend, password reset, magic link, email change (Supabase Auth → Send Email hook) | Always (security) |
| Task reminder | Personal reminder due (reminder job) | Settings → Email reminders + per-project |
| Workspace task reminder | Workspace task `reminder_at` reached (reminder job; assignee, else creator) | Settings → Email reminders |
| Task assigned | DB trigger on assignment by someone else | Workspace emails + workspace "Mentions and assignments" |
| Mention | DB trigger on @mention | Same as above |
| Task updates (digest, 5 min) | Someone else changes status/priority/due/title of, or comments on, a task assigned to you | Workspace emails + workspace "Task updates" |
| Workspace invitation | Owner/admin → Team → Invite by email (max 10 per send, 50 per workspace per day, no repeat within 24 h) | — (recipient is not a user yet) |
| Product news | Admin console → Product emails (see `docs/admin-portal.md`) | Settings → Product news (on by default; unsubscribe link + `List-Unsubscribe` one-click) |
| Account deleted | After deletion | Always (security) |

Invite links are the workspace's existing join link (`/workspace?join=CODE`). If the invitee is not
signed in, the code is remembered through sign-up/onboarding so they land on the join step.

## How it works

```
reminder job (personal + workspace) ──┐
DB triggers: assigned / mention / ────┤
  task update / comment               ├─► private.email_outbox ─► email-dispatch (every minute)
admin console broadcast ──────────────┘        (one row per event)      │ re-checks live data + prefs
                                                                         │ renders template (EN/AR)
delete-account ─────────────────────────────────────────────────────────►│ Resend SDK + idempotency key
Resend webhooks ─► /api/resend-webhook ─► private.email_suppressions ◄───┘ (skips suppressed)
```

- Code: `netlify/functions/_shared/email/` (config, service, templates, layout, outbox, webhook).
- All sending is server-side; the API key never reaches the browser. No public endpoint sends email.
- **Duplicates:** one outbox row per event (`dedupe_key` unique) and one Resend idempotency key per
  batch, kept across retries.
- **Digests:** several assignments or mentions for the same person and workspace within the
  1–2 minute window go out as one email.
- **Preferences:**
  - Settings → "Email reminders" plus the per-project switches control reminder email.
  - Settings (or the workspace profile) → "Workspace emails" controls assignment and mention email.
  - Workspace profile → "Mentions and assignments" off stops both the in-app and email notifications.
- **Safety:** only confirmed addresses are emailed, and suppressed (bounced or complained) addresses
  are skipped. Retries happen only for rate limits and provider errors (1, 5, 15 and 60 minutes, at
  most 5 attempts). Reminders older than 6 hours and workspace emails older than 24 hours are dropped.
- **Missing configuration:** without `RESEND_API_KEY`, queued rows are marked `skipped/not_configured`,
  never sent late. App features keep working.
- **Logs:** structured JSON lines (`scope: "email"`) with outcome codes and message ids only. No
  addresses, subjects, bodies or tokens.

## Environment variables

Netlify (site `hillm`) → Site configuration → Environment variables. Scope: **Functions**. These
are server-only: never prefix them with `VITE_` or `NEXT_PUBLIC_`.

| Variable | Production | Deploy previews / branch deploys | Local dev (`.env`) |
|---|---|---|---|
| `RESEND_API_KEY` | Required. Sending-access key restricted to `hilm.tech`; mark as secret | **Leave unset** (previews share the production database; unset = no email) | Optional, only for `npm run email:test` |
| `RESEND_WEBHOOK_SECRET` | Required for bounce/complaint handling (`whsec_…` from the Resend webhook) | Unset | Not needed |
| `RESEND_FROM_NOTIFICATIONS` / `_SECURITY` / `_TEAM` / `_MARKETING` | Optional; defaults above | — | — |
| `EMAIL_UNSUBSCRIBE_SECRET` | Required for product news (32+ random characters; signs unsubscribe links) | Unset | — |
| `ADMIN_HOST` | Private console hostname (Builds + Functions scope) | Unset | — |
| `SUPABASE_AUTH_HOOK_SECRET` | Required for Hilm-styled auth emails (`v1,whsec_…` from Supabase → Auth Hooks) | Unset | — |
| `APP_BASE_URL` | Optional; falls back to existing `APP_URL` (`https://app.hilm.tech`) | — | `http://localhost:5173` if testing links |
| `EMAIL_TEST_RECIPIENT` | Do not set | — | Your own address, for the manual test |
| `CRON_SECRET`, `DATABASE_URL` | Already set | — | — |

`email-dispatch` is a scheduled function, so Netlify runs it only on the published production deploy.

## Deployment order

1. **Database:** apply `supabase/migrations/0037_email_delivery.sql` and `0038_email_engagement.sql`
   *before* deploying the code. The app's settings query reads the new columns.
2. **Resend domain + DNS:** see below, and wait until the domain shows **Verified** in Resend.
3. **API key:** Resend → API Keys → create a key with *Sending access*, domain `hilm.tech`, then
   set `RESEND_API_KEY` in Netlify (Production, Functions).
4. **Deploy** the code (push to `main`).
5. **Webhook:**
   1. In Resend → Webhooks, add `https://app.hilm.tech/api/resend-webhook` with the events
      `email.bounced`, `email.complained`, `email.suppressed` (`email.delivered` optional).
   2. Copy the signing secret into `RESEND_WEBHOOK_SECRET`.
   3. Redeploy.
6. **Supabase Auth SMTP:** see below.
7. **Delivery test:** see "Manual test".

New domains should ramp up gradually. Hilm's volume (reminders and team notifications) is far below
Resend's warm-up limits.

## DNS (Resend domain `hilm.tech`, verified)

The DNS for `hilm.tech` is hosted on **Netlify DNS** (zone `hilm.tech`). Resend has `hilm.tech`
verified (region ap-northeast-1, sending only, open/click tracking off) with these records:

| Type | Name | Purpose |
|---|---|---|
| TXT | `resend._domainkey.hilm.tech` | DKIM key (d=hilm.tech) |
| CNAME | `send.hilm.tech` → `send.forge.rmta.net` | Return path (bounces); SPF is evaluated here |
| CNAME | `rsend.hilm.tech` → `rsend-apne1.forge.rmta.net` | Return path (regional) |

None of these share a hostname with the Amelu or Netlify records below, and the root SPF stays as it is.

Get the exact records from Resend; never type them from memory. With a full-access key:

```bash
RESEND_API_KEY=re_... npm run email:dns -- --create --region=eu-west-1   # first time: creates the domain
RESEND_API_KEY=re_... npm run email:dns                                  # report + live DNS check
RESEND_API_KEY=re_... npm run email:dns -- --verify                      # after adding records
```

The report prints, for each record:

- the type, the name to enter in Netlify DNS, the full hostname, the value, the priority and the TTL;
- whether it already exists in live DNS;
- whether it would conflict with an existing record, such as a second SPF record.

### Records that must not change

| Record | Why |
|---|---|
| `NETLIFY` `hilm.tech`, `www.hilm.tech`, `app.hilm.tech` | Website and app hosting |
| `MX hilm.tech → marduk.mx.amelu.org` (10) | Amelu mailbox `info@hilm.tech` |
| `TXT hilm.tech "v=spf1 mx -all"` | Root SPF for Amelu. Resend's SPF goes on its own hostname, so no merge is needed. Never add a second SPF record at `hilm.tech` |
| `TXT v1-ed25519-20261030._domainkey` / `v1-rsa-20261030._domainkey` | Amelu DKIM |
| `TXT hilm.tech google-site-verification=…` | Google Search Console |
| `TXT _dmarc.hilm.tech "v=DMARC1; p=none; rua=mailto:postmaster@hilm.tech"` | DMARC |

**DMARC:**
- Resend signs with DKIM for `hilm.tech`, so messages from `*@hilm.tech` align and pass DMARC.
- `p=none` only reports. Tightening it to `quarantine` or `reject` later affects Amelu mail too, so
  only do it after the reports show every legitimate source passing.
- Receiving stays disabled in Resend. Never point the root MX at Resend (it belongs to Amelu).

## Supabase Auth email (verification, password reset, magic link)

Supabase Auth still creates, expires and verifies every token; Hilm has no competing reset flow.
With the **Send Email hook**, Supabase hands each email to Hilm instead of mailing it itself, so it
goes out in Hilm's design and language with a 6-digit code plus a button. The app has code-entry
screens after sign-up and on "Forgot password".

**Recommended — Send Email hook** (only enable after Resend is verified and the key is set;
while the hook is on, Supabase does not send auth email itself):

1. Supabase Dashboard → Authentication → **Hooks** → *Send Email hook* → Enable → type **HTTPS**:
   - URL: `https://app.hilm.tech/api/auth-email-hook`
   - Generate the secret, copy it (`v1,whsec_…`) into Netlify `SUPABASE_AUTH_HOOK_SECRET`, redeploy.
2. Authentication → **Rate Limits**: raise the hourly email limit to fit sign-up volume.
3. Keep **URL Configuration** unchanged (Site URL `https://app.hilm.tech`, redirect allow-list
   `/auth/callback**`, `/auth/confirm**`). The button uses Supabase's own `/auth/v1/verify` link.
4. Test: sign up with a real inbox → enter the code; "Forgot password" → enter the code → set a
   new password. If the hook fails, Supabase shows the user an error instead of sending nothing silently.

**Fallback — custom SMTP** (Supabase's own templates, no Hilm design): use this only if the hook is
off. Settings:

1. Supabase Dashboard → Authentication → Emails → **SMTP Settings** → enable custom SMTP:
   - Host: `smtp.resend.com`
   - Port: `465` (SSL), or `587` (STARTTLS)
   - Username: `resend`
   - Password: a Resend API key with sending access (a separate key from Netlify's makes rotation easier)
   - Sender email: `security@hilm.tech`
   - Sender name: `Hilm`
2. Authentication → **Rate Limits**: custom SMTP starts with a low hourly email limit; raise it to fit
   sign-up volume.
3. Keep the existing **URL Configuration**:
   - Site URL: `https://app.hilm.tech`
   - Redirect allow-list: `/auth/callback**`, `/auth/confirm**`

   Templates must keep using `{{ .ConfirmationURL }}` (see `docs/auth-email-templates.md`).
4. Optional: if your project offers security notification emails (password changed, email changed),
   enable them there. They then go through the same SMTP.
5. Test sign-up, password reset and email change with a real inbox. Supabase keeps generating and
   verifying the tokens; only the delivery path changes.

## Manual test (sends only to you)

```bash
npm run email:preview                         # writes email-previews/*.html (+ .txt); sends nothing
RESEND_API_KEY=re_... EMAIL_TEST_RECIPIENT=you@example.com npm run email:test              # dry run
RESEND_API_KEY=re_... EMAIL_TEST_RECIPIENT=you@example.com npm run email:test -- --send    # 3 identities
RESEND_API_KEY=re_... EMAIL_TEST_RECIPIENT=you@example.com npm run email:test -- --send --samples --locale=ar
```

`delivered@resend.dev`, `bounced@resend.dev` and `complained@resend.dev` simulate outcomes. Use
`bounced@` to check the webhook adds a suppression.

## Operations

Run these with a service connection (`private` is not exposed to the API):

```sql
-- Queue health
select kind, status, last_error, count(*) from private.email_outbox
where created_at > now() - interval '1 day' group by 1, 2, 3 order by 1, 2;

-- Lift a suppression after the user fixes their mailbox
delete from private.email_suppressions where email = lower('person@example.com');
```
