# Subscriptions, entitlements and usage accounting

Hilm has one identity per person and two independent commercial environments:

| Scope | Plans | Held by | Pays |
|---|---|---|---|
| Personal OS | Free (0 SAR), Pro (30 SAR / month) | the user (`profiles.ai_tier_id`) | the user |
| Workspace OS | Team (250 SAR / month, 1 workspace), Team Pro (400 SAR / month, up to 3 workspaces) | a `workspace_subscriptions` row attached to each workspace (`workspaces.subscription_id`) | the subscription's billing owner |

A person's personal plan never decides what they can do inside a workspace, and workspace activity
never uses their personal allowance. Joining a paid workspace is free for any personal plan.

## Where entitlements live

All plans are rows of one catalog, `public.ai_quota_tiers` (column `scope` = `personal` or
`workspace`). Prices (`price_sar_monthly`, `price_sar_yearly`), workspace counts, project limits,
storage, AI request/token/cost limits, meeting minutes and per-member safeguards are columns, edited
in the admin console (**Subscriptions → Plan configuration**). Changes apply from that moment; usage
events keep the plan id and cost they were recorded with, so history is never rewritten.

## Why plans appear in both the frontend and the backend

* **Backend (authoritative).** Every limit is enforced in Postgres, inside `SECURITY DEFINER`
  functions and triggers that users cannot bypass:
  * `begin_ai_request(..., p_scope)` — AI quota per scope (see below), with reservations and an
    advisory lock per accounting pool;
  * `create_workspace` — requires a usable Team/Team Pro subscription with a free workspace slot;
  * trigger `workspace_projects_plan_limit` — active projects per workspace;
  * `private.storage_quota_for` — workspace storage from the plan (admin override first);
  * `register_meeting_segment` / `meeting_quota_status(p_user_id, p_workspace_id)` — meeting minutes
    per scope;
  * `can_edit_workspace_content` — returns false once a workspace subscription has lapsed past its
    grace period, which makes every workspace write policy read-only.
  Users cannot change `ai_tier_id` to a workspace plan (trigger), cannot write
  `workspace_subscriptions`, cannot re-link `workspaces.subscription_id` (trigger), and cannot write
  the usage ledger.
* **Frontend (presentation only).** The app reads the same catalog (`plan_catalog`, `my_billing`,
  `workspace_usage_summary`) to explain plans, show usage and pick the right upgrade prompt before a
  request is refused. It never decides whether something is allowed: if the UI is stale or tampered
  with, the database still refuses.

## Accounting scope

Every metered AI event (`public.ai_usage_events`) carries:

| Column | Meaning |
|---|---|
| `scope` | `personal` (workspace_id must be null) or `workspace` (workspace_id required) — checked by a constraint |
| `user_id`, `workspace_id` | who acted, and where |
| `plan_id`, `subscription_id` | the plan / workspace subscription that was charged |
| `request_kind`, `model` | resource category and provider model |
| `input_tokens`, `output_tokens`, `total_tokens`, `audio_ms`, `estimated_cost_usd`, `provider_cost_usd` | quantity and cost |
| `reserved_tokens` | allowance held while the call runs |
| `status` | `started` (reserved) → `completed` / `failed` (finalized), `rejected`, `duplicate`, `reversed` |
| `idempotency_key` | one event per operation and user |
| `billing_period` | generated: the UTC month of the event |

Rules in `begin_ai_request`:

* The caller states the scope (`p_scope`). Server code always passes it: chat and the roadmap report
  pass `workspace` only when the request carries a workspace, meetings pass the meeting's OS, the
  daily log is always `personal`.
* A workspace request must name the workspace and the caller must be a member; otherwise it is
  rejected (`workspace_required`, `not_workspace_member`). A personal request that names a workspace
  is rejected (`scope_mismatch`). Nothing ever falls back to the other scope.
* Personal requests count only the user's `personal` events against their personal plan.
* Workspace requests count all members' `workspace` events of that workspace against the workspace
  plan (pooled), plus per-member abuse protection (`requests_per_minute`, `max_concurrent`,
  `member_requests_per_day`) which never touches the member's personal allowance.
* Concurrency: an advisory lock per pool serialises decisions, and in-flight `reserved_tokens`
  count against the token limits until the call completes.
* Idempotency: a repeated key returns `duplicate` / `in_flight`; `complete_ai_request` finalizes an
  event once (`already_completed` afterwards).
* When a workspace allowance runs out, the owner and admins get one in-app notification per limit
  per day (`workspace.ai_limit`).

Storage is accounted in `storage_usage` by `scope_type` (`user` / `workspace`); meeting minutes in
`meeting_minutes_ledger` by `os` / `workspace_id`.

## Workspace plans (initial configuration)

| | Team | Team Pro |
|---|---|---|
| Price | 250 SAR / month | 400 SAR / month |
| Workspaces | 1 | 3 |
| Active projects per workspace | 10 | 10 |
| AI requests (pooled, per workspace) | 400 / day, 6,000 / month | 600 / day, 9,000 / month |
| AI tokens (pooled) | 750,000 / day, 12M / month | 1.1M / day, 18M / month |
| AI spend cap | $1.50 / day, $15 / month | $2.25 / day, $22 / month |
| Per-member safeguard | 10 / minute, 120 requests / day, 2 concurrent | 12 / minute, 160 / day, 3 concurrent |
| Meeting minutes (pooled) | 1,200 / month | 1,800 / month |
| Storage | 5 GB | 10 GB per workspace |

Personal plans are unchanged (Free: 30 requests and 25,000 tokens a day, 900 requests a month,
60 meeting minutes; Pro: 80 / 150,000 / 1,500 / 300).

## Lifecycle

`workspace_subscriptions.status`: `active`, `trialing`, `comped`, `past_due`, `canceled`, `expired`.
The effective state (`private.workspace_entitlement`) is:

* **active** — status active/trialing/comped within the period, or canceled before period end;
* **grace** — period ended, payment failed or expired, for `grace_days` (default 7) — full access;
* **restricted** — after grace: read-only, no workspace AI, nothing deleted;
* **none** — no subscription (read-only).

Personal and workspace lifecycles are independent: changing a personal plan never touches a
workspace subscription and vice versa. Workspace ownership (roles) and billing ownership
(`owner_user_id`) are separate; billing ownership moves only through the admin console (audited).
Downgrading Team Pro → Team keeps existing workspaces; only new ones are blocked.

## Payments

There is no payment provider integration yet. Upgrade buttons create a `subscription_requests` row
(`request_plan_upgrade`); an administrator activates the subscription in the console
(**Subscriptions**), which records it as `provider = 'manual'`. Renewal, failed payment and
expiry are set there (status / period end). Annual pricing is a catalog column with no value until
approved. Workspaces that existed before billing were each given a complimentary (`comped`) Team
subscription so nothing broke; review them in the console.
