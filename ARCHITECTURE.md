# Hilm architecture — Personal OS & Workspace OS

Hilm is **one application, two products**: **Personal OS** and **Workspace OS**. They may share genuinely generic infrastructure, but **business logic, domain ownership, data access, and feature dependencies must remain isolated**.

The goal is not to rewrite Hilm or redesign the application. The goal is to make the architecture clean enough that Workspace OS can be copied into an independent company-owned repository without Personal OS.

```text
HILM
├── Personal OS      (/personal/*)
├── Workspace OS     (/workspace/:id/*)
└── Shared           (auth, UI primitives, generic utilities, OS-agnostic engines)
```

**Hard rules (non-negotiable):**

- No UI redesign, route changes, feature removal, or user-facing behavior changes (except fixes required to preserve functionality during refactor).
- Do not break either OS. Do not weaken Supabase RLS. Do not duplicate the database. No second production deployment. No company repo yet. No big-bang rewrite.
- Personal OS ❌→ Workspace OS business logic. Workspace OS ❌→ Personal OS business logic.
- Extract genuinely shared functionality; do not solve coupling with cross-OS imports.
- Before moving code into `shared/`, verify it is OS-agnostic (no Personal/Workspace table access, auth assumptions, or domain logic).

**Core import rule:**

| From | Must NOT import |
|------|-----------------|
| Personal feature folders | `features/workspace-os` (except documented bridges) |
| `features/workspace-os` | Personal business folders (`tasks`, `projects`, `home`, …) |
| `shared/` | Either OS business logic |

Enforced by `npm run check:boundaries` (fails build). Extraction readiness verified by `npm run check:extraction`.

---

## Layer overview

```text
src/
├── shared/                 # Cross-OS modules (both Personal and Workspace may import)
├── features/
│   ├── workspace-os/       # Workspace OS boundary — company extraction root
│   ├── tasks/, projects/, … # Personal OS domains (documented, not renamed)
│   ├── ai/                 # OS-specific registries + page wrappers
│   ├── reports/            # Personal persistence pages + personal-api
│   ├── auth/               # Shared authentication
│   └── personal/           # Bridge: Personal → Workspace launcher
├── components/ui/          # Design system
├── lib/                    # Generic utilities (no OS-specific business logic)
└── app/router.tsx          # Route tree (URLs unchanged)
```

### Import rules (enforced by `npm run check:boundaries`)

| From | May import |
|------|------------|
| Personal feature folders (`tasks`, `projects`, `home`, `notes`, `ideas`, `daily-log`, `search`, `mission-control` pages, `reports/PersonalReportsPage`, `ai/PersonalAiPage`, …) | `shared/*`, `components/*`, `lib/*`, `features/auth`, `types`, **not** `features/workspace-os` |
| `features/workspace-os/**` | `shared/*`, `components/*`, `lib/*`, `features/auth`, `types`, **not** personal business folders (`tasks`, `projects`, `home`, …) |
| Bridge pages (`personal/PersonalWorkspacesPage`, `onboarding/OnboardingPage`) | May import `workspace-os` (documented exception) |
| `shared/**` | `components/*`, `lib/*`, `types`, other `shared/*` — **not** either OS feature folder |

Run `npm run check:boundaries` locally before merging isolation changes.

---

## Personal OS

**Routes:** `/personal/*` — home, projects, tasks, kanban, AI, mission control, reports, settings, profile, notes, ideas, daily log, search.

**Feature folders:** `src/features/tasks/`, `projects/`, `home/`, `notes/`, `ideas/`, `daily-log/`, `search/`, `mission-control/MissionControlPage.tsx`, `reports/PersonalReportsPage.tsx`, `ai/PersonalAiPage.tsx`, `settings/`, `activity/`, `notifications/`, `announcements/`, `landing/`, `scaffold/`.

**Primary DB tables:**

| Table | Purpose |
|-------|---------|
| `projects`, `tasks`, `task_labels`, `labels` | Personal project/task domain |
| `notes`, `ideas`, `daily_logs` | Content |
| `ai_reports` | Saved personal reports |
| `ai_conversations`, `ai_messages` | AI chat (`workspace_id` IS NULL) |
| `activity_events` | Personal activity feed |
| `attachments` | Personal file metadata |
| `profiles`, `user_settings` | Shared user identity (both OSes) |

**Storage paths (bucket `attachments`):** `{userId}/tasks/{taskId}/…`, `{userId}/projects/…` — see `0001_init.sql`, `0003_tasks_projects_reminders.sql`.

**Serverless (personal-only):** `send-task-reminders`, `ai-daily-log`.

---

## Workspace OS

**Routes:** `/workspace/:workspaceId/*` — selector, home, projects, tasks, team, org, CRM, AI, mission control, reports, settings, profile, activity.

**Feature folder:** `src/features/workspace-os/` (~43 modules): `api.ts`, `org-api.ts`, `crm-api.ts`, `labels-api.ts`, `comments-api.ts`, `attachments-api.ts`, `reports-api.ts`, pages, components, context providers, load balancer, permissions.

**Primary DB tables:**

| Table | Purpose |
|-------|---------|
| `workspaces`, `workspace_members`, `workspace_invites` | Tenancy |
| `workspace_projects`, `workspace_tasks`, `workspace_labels` | Workspace domain |
| `workspace_departments`, `workspace_teams`, … | Org structure |
| `workspace_ai_reports` | Saved workspace reports |
| `workspace_activity`, `workspace_attachments` | Activity & files |
| `workspace_crm_*` | CRM entities |
| `ai_conversations.workspace_id` | Workspace-scoped AI threads |

**Storage paths:** `workspace/{workspaceId}/tasks/{taskId}/…` — see `0019_sprint_foundations.sql`.

---

## Shared layer (`src/shared/`)

Extracted modules used by **both** OSes:

| Module | Contents |
|--------|----------|
| `shared/reminders/` | Reminder types, `combineDueAt`, `computeRemindAt`, `TaskWithProject` |
| `shared/project-icons/` | `ProjectIcon`, `ProjectIconPicker` |
| `shared/mission-control/` | Calendar, timeline, overview, horizon, schedule helpers |
| `shared/reports/` | Report engine, PDF, `ReportStudio`, types, catalog, i18n, `defaultConfig` |
| `shared/user-profile/` | `getProfile`, profile/settings query keys |
| `shared/ai/` | `AiChatShell` — mode-agnostic AI chat UI |

Personal and workspace pages import from `@/shared/*`. Old feature paths may re-export during migration; prefer `@/shared/*` in new code.

---

## Auth (shared)

`src/features/auth/` — login, signup, callback, reset password, `AuthProvider`, onboarding gate. Supabase Auth is shared; `user_settings.default_startup_mode` controls Personal vs Workspace entry.

---

## AI

- **Registry keys:** `personal:*` (`features/ai/registry/personal.ts`) vs `workspace:*` (`features/workspace-os/ai/registry/workspace.ts`).
- **Conversations:** `ai_conversations.workspace_id` null = personal; non-null = workspace-scoped.
- **Shared infrastructure:** `shared/ai/AiChatShell.tsx`, `features/ai/lib/action-executor.ts`, parsing/validation, streaming UI — OS-agnostic pipeline only.
- **OS-specific:** registries, preview directories, invalidation, batch helpers (`workspace-os/lib/batch-engine.ts`), data hooks.
- **Rule:** Workspace AI must not call Personal task/project APIs. Personal AI must not call Workspace APIs. Registries bootstrapped per OS page (`PersonalAiPage`, `WorkspaceAiPage`).
- **Netlify `ai-chat`:** dual-mode function (single deploy); company repo would ship workspace catalog subset from `_shared/ai-action-catalog.ts`.

---

## Reports

- **Engine (shared):** `shared/reports/` — receives structured snapshots; does not query OS-specific tables directly from pages.
- **Persistence (split):**
  - Personal: `features/reports/personal-api.ts` → `ai_reports` + `activity_events`
  - Workspace: `features/workspace-os/reports-api.ts` → `workspace_ai_reports` + workspace activity

---

## Mission Control

- **Shared (visual/interaction):** `shared/mission-control/` — calendar, timeline, overview, horizon, schedule helpers.
- **OS-specific:** pages fetch tasks/projects via their own APIs; adapters (`workspace-os/lib/mission-adapters.ts`) map workspace rows to shared shapes.
- **Navigation:** shared components accept `resolveTaskHref` / `resolveProjectHref` props (defaults preserve Personal routes).

---

## Data isolation

Personal persistence is user-scoped (`projects`, `tasks`, `ai_reports`, `activity_events`, …). Workspace persistence is workspace-scoped (`workspace_*` tables). Neither OS should depend on the other's tables for core functionality. RLS boundaries are unchanged.

---

## Extraction simulation

Do not assume extractability from import rules alone. Run:

```bash
npm run check:extraction
```

This follows static imports from `features/workspace-os/` and fails if Personal OS domain code enters the closure. Manifest: `scripts/company-build-manifest.json`.

**Documented bridges** (warn only; resolve before real company fork):

- `WorkspacePersonalSettingsPage` → `SettingsPage` (extract shared settings shell)
- `useTimeFormat` and workspace profile pages use `shared/user-settings` (not personal settings pages)

Static import simulation passes with `--include-dynamic` available for stricter audits.

Future company repo = `workspace-os` + required `shared` subset + `auth` + `components/ui` + generic `lib` + workspace AI registry/infrastructure.

---

## Storage summary

| OS | Bucket | Path pattern |
|----|--------|--------------|
| Personal | `attachments` | `{userId}/tasks/...` |
| Workspace | `attachments` | `workspace/{workspaceId}/tasks/...` |

RLS policies are per-table; extraction does not require weakening RLS.

---

## Serverless functions

| Function | Mode |
|----------|------|
| `ai-chat` | Dual (personal + workspace actions) |
| `delete-account` | Dual (cleans both OS data) |
| `send-task-reminders` | Personal only |
| `ai-daily-log` | Personal only |

---

## Future extraction checklist (company repo)

When creating a standalone Workspace product repo:

### Copy

1. `src/features/workspace-os/**`
2. `src/shared/**` (full tree at time of extraction)
3. `src/components/ui/**`, shared layout pieces used by workspace shell
4. `src/features/auth/**`
5. `src/features/ai/registry/workspace.ts`, `registry/bootstrap.ts`, `registry/schemas.ts`, shared executor libs
6. `src/shared/ai/**`, workspace i18n keys
7. Supabase migrations for workspace tables + shared auth/profile
8. Workspace storage policies; `_shared/ai-action-catalog.ts` (`workspaceActionCatalog` only)
9. Netlify functions: workspace subset of `ai-chat`, optional `delete-account` workspace branch

### Delete (from company repo)

1. Personal feature folders: `tasks/`, `projects/`, `home/`, `notes/`, `ideas/`, `daily-log/`, `search/`, personal mission page, `reports/PersonalReportsPage.tsx`, `ai/registry/personal.ts`, `ai/PersonalAiPage.tsx`
2. Personal cron functions: `send-task-reminders`, `ai-daily-log`
3. Personal-only lib: `features/activity/record.ts`, `features/tasks/email/`

### Replace

1. Router → workspace-only tree (keep `/workspace/:id/*` URLs)
2. Env → separate Supabase project (no personal tables required for workspace app boot)
3. Default landing → workspace selector

### Keep in private Hilm repo

Both OSes continue to develop together; shared modules stay the integration point until company repo forks.

---

## Intentional bridges (do not “fix”)

- `features/personal/PersonalWorkspacesPage.tsx` — Personal user opens/creates workspaces
- `features/onboarding/OnboardingPage.tsx` — first-run workspace create/join
- `features/auth/startup.ts` — reads `StartupMode` from workspace permissions types

These are documented cross-OS entry points, not boundary violations.
