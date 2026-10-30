# Transactional email (Resend)

Hilm sends app email through [Resend](https://resend.com) from the dedicated sending subdomain
**send.hilm.tech**. The business mailbox `info@hilm.tech` (Amelu) is separate and is only used as
the Reply-To address, because the sending identities below cannot receive mail.

| Identity | Used for |
|---|---|
| `Hilm Notifications <notifications@send.hilm.tech>` | Task reminders, workspace assignments, mentions |
| `Hilm Security <security@send.hilm.tech>` | Account deleted notice; recommended sender for Supabase Auth email |
| `Hilm Team <team@send.hilm.tech>` | Delivery tests; reserved for future team announcements |

## How it works

```
reminder job (Netlify, every minute) ─┐
DB trigger: workspace task assigned ──┼─► private.email_outbox ─► email-dispatch (every minute)
DB trigger: comment mention ──────────┘        (one row per event)      │ re-checks live data + prefs
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
| `RESEND_API_KEY` | Required. Sending-access key restricted to `send.hilm.tech`; mark as secret | **Leave unset** (previews share the production database; unset = no email) | Optional, only for `npm run email:test` |
| `RESEND_WEBHOOK_SECRET` | Required for bounce/complaint handling (`whsec_…` from the Resend webhook) | Unset | Not needed |
| `RESEND_FROM_NOTIFICATIONS` / `_SECURITY` / `_TEAM` | Optional; defaults above | — | — |
| `APP_BASE_URL` | Optional; falls back to existing `APP_URL` (`https://app.hilm.tech`) | — | `http://localhost:5173` if testing links |
| `EMAIL_TEST_RECIPIENT` | Do not set | — | Your own address, for the manual test |
| `CRON_SECRET`, `DATABASE_URL` | Already set | — | — |

`email-dispatch` is a scheduled function, so Netlify runs it only on the published production deploy.

## Deployment order

1. **Database:** apply `supabase/migrations/0037_email_delivery.sql` *before* deploying the code.
   The app's settings query reads the new columns.
2. **Resend domain + DNS:** see below, and wait until the domain shows **Verified** in Resend.
3. **API key:** Resend → API Keys → create a key with *Sending access*, domain `send.hilm.tech`, then
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

## DNS for send.hilm.tech

The DNS for `hilm.tech` is hosted on **Netlify DNS** (zone `hilm.tech`).

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

Resend's sending records all live **under** `send.hilm.tech`: a DKIM TXT record, plus an MX and an
SPF TXT record for the bounce (return-path) host. None of them share a hostname with existing
records.

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
- The root policy also covers `send.hilm.tech`. Resend signs with DKIM for `send.hilm.tech`, so
  messages from `*@send.hilm.tech` align and pass.
- `p=none` only reports. Tightening it to `quarantine` or `reject` later affects Amelu mail too, so
  only do it after the reports show every legitimate source passing.
- Receiving on `send.hilm.tech` stays disabled in Resend. Never point the root MX at Resend.

## Supabase Auth email (verification, password reset, magic link)

These emails are sent by **Supabase Auth**, not by Hilm's code. Hilm does not replace them and has no
competing reset flow. To deliver them through Resend:

1. Supabase Dashboard → Authentication → Emails → **SMTP Settings** → enable custom SMTP:
   - Host: `smtp.resend.com`
   - Port: `465` (SSL), or `587` (STARTTLS)
   - Username: `resend`
   - Password: a Resend API key with sending access (a separate key from Netlify's makes rotation easier)
   - Sender email: `security@send.hilm.tech`
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
