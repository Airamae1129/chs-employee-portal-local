# CHS Employee Portal

A working full-stack scaffold for the Cyberhealth staff self-service portal:
three role-based login entry points (Employee / Manager / Admin), timekeeping
with an integrated calendar, HR requests, policies, client workspace links,
team oversight, a dual payslip system (Ireland upload / Philippines
generated), a Microsoft Teams webhook integration, and an audit log —
implementing Phase 1 in full and scaffolding Phases 2–3, per the build prompt
this was generated from.

## What's implemented vs. stubbed

**Fully implemented and tested end-to-end** (Phase 1): Entra ID-shaped auth
with a local password fallback, the three `/login/:role` entry points with
server-side role verification, the role-aware dashboard shell, clock in/out
+ calendar (holidays, leave, personal task notes), HR requests with
manager/admin approval, policies with acknowledgement tracking, client
workspace directory + access requests, the Teams webhook (fire-and-forget,
retry/backoff, audit-logged on failure), staff account management, and the
audit log.

**Scaffolded, functionally wired, ready to extend** (Phase 2–3): team
availability/resourcing (`ResourceAllocation`), the Philippines payroll
engine (locks a period's time entries, computes gross/deductions/net from
`SalaryConfig`, Draft → Approved → Published), and Ireland payslip upload.
The generated payslip PDF is a plaintext placeholder — swap in a real
template (see the `pdf` skill, or `pdf-lib`) before using this for real
payroll. Microsoft Graph free/busy and Entra ID SSO itself are stubbed with
clear `TODO`s (see below) rather than faked, since they need a real Azure
tenant to implement against.

## Why Kysely instead of Prisma

This was originally scaffolded against Prisma, but Prisma's query/schema
engine binaries are fetched from `binaries.prisma.sh` at install/generate
time — which is blocked by egress policy in some CI and sandboxed dev
environments (it was, in the environment this scaffold was built in). Rather
than ship something that couldn't actually be run and tested, the data layer
uses [Kysely](https://kysely.dev) (a typed SQL query builder) directly
against [node-postgres](https://node-postgres.com), with a hand-written SQL
migration (`packages/db/sql/001_init.sql`) as the single source of truth for
the schema. No native binaries, works in any environment with network access
to npm. If your team prefers Prisma, `packages/db` is a small, self-contained
package — swapping it back out is a contained change that doesn't touch any
route's business logic.

## Project layout

```
apps/web/          Next.js 14 (App Router) frontend, Tailwind styled to the
                    Cyberhealth CMS reference screenshots
apps/api/           Express + TypeScript REST API
packages/db/        Kysely + node-postgres data layer, SQL schema, seed script
storage/            Local file storage (policies, payslips) — dev/local only
docker-compose.yml  Optional Postgres + Adminer (see note below)
```

## Prerequisites

- Node.js 20+
- A PostgreSQL 16 server. Either:
  - `docker compose up -d postgres` (needs a running Docker daemon), or
  - a local Postgres install — create a `chs` role and `chs_portal` database
    matching `DATABASE_URL` in `.env.example`.

## Setup

```bash
cp .env.example .env          # fill in real values later; defaults work for local dev
npm install                   # installs all workspaces
npm run db:migrate            # applies packages/db/sql/*.sql
npm run db:seed               # creates sample Admin/Manager/Employee accounts
npm run dev:api                # starts the API on :4000
npm run dev:web                # in another terminal: starts the web app on :3000
```

Open http://localhost:3000 — it redirects to `/login/employee`. Try
`/login/manager` and `/login/admin` too.

**Seeded accounts** (password login, since Entra ID isn't configured in
local dev — see below). All seeded users share one password:

| Role     | Email                        | Password      |
|----------|-------------------------------|---------------|
| Admin    | admin@cyberhealth.ie          | `ChsDev!2026` |
| Manager  | manager.ie@cyberhealth.ie      | `ChsDev!2026` |
| Manager  | manager.ph@cyberhealth.ie      | `ChsDev!2026` |
| Employee | aira@cyberhealth.ie (PH)       | `ChsDev!2026` |
| Employee | liam@cyberhealth.ie (IE)       | `ChsDev!2026` |
| Employee | grace@cyberhealth.ie (IE)      | `ChsDev!2026` |
| Employee | jomari@cyberhealth.ie (PH)     | `ChsDev!2026` |

Change these before this ever sees a real network — see Security below.

## Wiring up the real integrations

### Microsoft Entra ID SSO

Fill in `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`,
`ENTRA_REDIRECT_URI` in `.env`, then implement the two `TODO`s in
`apps/api/src/routes/auth.ts` (`/auth/entra/start`, `/auth/entra/callback`)
using `@azure/msal-node`. The rest of the auth model — session issuance,
the three-entry-point role check, the 12-hour cookie expiry — is already
written and doesn't change; SSO just becomes a second way to reach
`issueSessionToken(...)`. Once configured, you can set
`ALLOW_PASSWORD_LOGIN=false` to require SSO-only sign-in.

### Microsoft Teams webhook

Create an Incoming Webhook connector on a "CHS – Time Logs" channel
(Manager + Admin membership only) in Teams, and put its URL in
`TEAMS_WEBHOOK_URL`. Every clock in/out already posts an Adaptive Card there
via `apps/api/src/utils/teams.ts` — it's wired up and tested (fire-and-forget,
retries with backoff, logs failures to the audit log without blocking the
clock event). Swap the `fetch()` call for a Microsoft Graph
`POST /teams/{team-id}/channels/{channel-id}/messages` call if you need
per-team routing or threaded corrections later — the payload builder and
retry wrapper stay the same.

### File storage

Defaults to local disk (`storage/`) with HMAC-signed, expiring URLs served
through `GET /files/:key`. `apps/api/src/utils/storage.ts` defines a small
`StorageAdapter` interface — implement it against `@aws-sdk/client-s3` (a
sketch is commented at the bottom of that file) and flip `STORAGE_DRIVER=s3`
in `.env` when a real bucket is provisioned. No route code changes.

## Security notes before any real deployment

- Rotate `JWT_SECRET` and every seeded password immediately.
- Put this behind HTTPS and set `secure: true` on the session cookie
  (already conditional on `NODE_ENV=production`).
- The Philippines payroll deduction calculation
  (`apps/api/src/routes/payroll.ts`) is a flat 12% placeholder — replace with
  real statutory deduction tables (SSS/PhilHealth/Pag-IBIG/withholding tax)
  before running real payroll.
- The generated payslip PDF is a plaintext stand-in — replace with a real
  template before publishing to employees.
- Review `apps/api/src/middleware/rbac.ts` and every route's use of
  `allow(...)` / `ownershipOrElevated(...)` against your actual compliance
  requirements — this scaffold implements Section 3/9 of the build prompt as
  written, but a real audit is worth doing before go-live.

## Known follow-ups

- `multer@1.x` has known CVEs; bump to `multer@2` (minor API changes) before
  production.
- The migration runner (`packages/db/scripts/migrate.ts`) is intentionally
  minimal (no rollback). Swap in a proper tool once the schema is evolving
  under real usage.
- Microsoft Graph free/busy for richer resourcing (Phase 2 stretch) is
  noted as a TODO in `apps/api/src/routes/availability.ts`.
