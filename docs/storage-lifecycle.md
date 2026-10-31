# Storage, retention and infrastructure monitoring

## Pieces

| Piece | Where |
|---|---|
| File registry (every stored object, any provider) | `public.storage_files` (migration 0046) |
| Upload contract | `storage_begin_upload` → upload to the issued key → `storage_complete_upload` (`src/lib/storage/uploads.ts`) |
| Retention policies | `public.storage_retention_policies` (platform → workspace / user, legal holds) |
| Quotas and usage | `public.storage_quota_overrides`, `public.storage_usage` |
| Deletion queue (the only one) | `private.storage_object_deletions` (from 0045, extended in 0046) |
| Lifecycle decisions | `private.storage_lifecycle_step` (SQL) |
| Lifecycle runner | `netlify/functions/_shared/storage/lifecycle.ts`, run by `scheduler.ts` every 10 minutes |
| Providers | `netlify/functions/_shared/storage/*-provider.ts` (Supabase active; R2 slot inactive) |
| Audit trail | `private.storage_lifecycle_events` (append-only), `private.storage_lifecycle_runs` |
| Monitoring | `private.ops_*` tables, collector `ops/collector.ts` (hourly), alerts `ops/alerts.ts`, console → Infrastructure |

The scheduler is the single scheduled function (every minute): reminders and the email outbox
every run; lifecycle and alert evaluation every 10 minutes; metrics hourly; usage reconciliation
and snapshot pruning daily. Job timing lives in `private.ops_collector_state`.

## Storage worker account

There is no service-role key on the server. Storage deletions run as a dedicated auth user
(`raw_app_meta_data.hilm_service = 'storage_worker'`, id in `private.server_secrets`
`STORAGE_WORKER_USER_ID`). Its only extra rights are the `storage_worker_select` and
`storage_worker_delete` policies on the `attachments` and `meeting-audio` buckets. Credentials:
Netlify env `STORAGE_WORKER_EMAIL` / `STORAGE_WORKER_PASSWORD`. To rotate, re-run the setup
procedure (new random password, same account) and redeploy. The account is excluded from user
counts and lists in the console.

## Lifecycle modes

`private.storage_lifecycle_settings.mode` (console → Infrastructure → Storage):

- `dry_run` – inventory and counts only (orphans and missing objects are still recorded).
- `quarantine` – expiry warnings (7 days and 1 day ahead) and quarantine of expired files.
  Quarantined files are not readable by anyone. Nothing is deleted.
- `enforce` – additionally purges files whose quarantine ended, purges orphans after their
  quarantine, deletes meeting audio after verified transcription, and drains the queue.

Safety rules built into the SQL:

- A file is quarantined only if the 7-day warning went out at least 7 days earlier and the 1-day
  warning at least a day earlier, even when its expiry date already passed during a dry run.
- Legal holds (file or scope) and `retain_until` extensions always win; extensions never shorten.
- A deletion counts only when the object is confirmed absent (`storage.objects` for Supabase, a
  fresh existence check for other providers). Provider errors are retried with backoff
  (5 min × 2^attempts, max 24 h) and become `failed` after `max_delete_attempts`.
- Per-run caps (`max_deletions_per_run`, `max_bytes_per_run`) and a circuit breaker
  (`circuit_breaker_files`): if more files are due at once, the run stops and the
  `lifecycle_circuit_breaker` alert fires.
- Inaccessible objects are never treated as deletable: missing objects are marked `missing`,
  unregistered objects become `orphaned` (24 h grace, then quarantine).

## Meeting audio

Audio is deleted when the meeting is `ready`, its full-recording transcription finished
(`stt_state` is `completed`, or null for meetings before Soniox), every audio segment is
`transcribed` and transcript text exists (`private.storage_meeting_transcribed`). Segment rows stay
(with `audio_deleted_at`) so transcripts, speakers, summaries and translations are untouched;
the meeting page hides playback and says the recording was removed.

Recordings of meetings analyzed before the lifecycle was installed are excluded until
`historical_audio_approved` is switched on in the console (after reviewing the inventory).

## Rollout

1. Apply the migration (mode `dry_run`). Review the inventory in the console.
2. Switch to `quarantine`: warnings start; expired files are quarantined no sooner than 7 days later.
3. Switch to `enforce` once the queue, warnings and quarantine behave as expected.
4. Approve historical audio when the inventory of transcribed recordings has been reviewed.

## Moving files between providers (for example Supabase → R2)

Nothing uses R2 today. To enable it:

1. Implement `createR2StorageProvider` (S3 API, SigV4) and set `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` on Netlify. R2 has no RLS: reads must go through a
   server endpoint that checks the registry row with the caller's identity and returns a short
   presigned URL.
2. Migrate one file at a time with `migrateFile(db, providers, fileId, { provider: 'r2', bucket },
   { rollbackDays })`: it copies the bytes, verifies size and SHA-256 at the source and after a
   read-back from the destination, then updates the registry (`provider`, `bucket`,
   `checksum_sha256`, `previous_location` with `rollback_until`). Any mismatch removes the copy
   and leaves the registry unchanged.
3. Rollback within the period: set `provider`/`bucket` back from `previous_location`.
4. After `rollback_until`, the lifecycle (enforce mode) queues the old copy
   (`reason = 'migration_rollback_expired'`) and deletes it through the old provider; the file
   itself stays active.

Tests: `netlify/functions/_shared/storage/migrate.test.ts` (fake providers).

## Monitoring quality classes

Every metric carries a source, collection time, frequency and one of: `provider_live`,
`provider_synced`, `app_calculated`, `estimated`, `manual`, `unavailable`. Metrics older than
twice their frequency are shown as stale. Supabase egress, Resend account usage and Soniox
balances have no API; they are `unavailable` until an admin records the dashboard value
(`manual`). Upgrade suggestions in the forecast are recommendations only; nothing is purchased.
