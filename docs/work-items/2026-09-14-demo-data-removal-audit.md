# Demo data removal audit and production readiness plan

Status: planned
Owner: Claude agent (Opus 5) for Raphaël Titsworth-Morin
Source: SAM task 01M2G63M344A7561TBGK02DX26 — "Remove all demo data and make app production-ready
with real Slack data". The requester asked what it will take to reach zero demo content and operate
only on real Slack data. No code changes were authorized in this pass; this record is the audit.
Branch: sam/still-bunch-demo-data-02dx26

## Intent

Inventory every demo, fixture, simulated and synthetic-data surface in the repository, and determine
what production readiness on real Slack data actually requires. The starting hypothesis — that demo
data is a removable layer on top of a working product — is wrong, and the reason is recorded below
so later agents do not repeat the analysis.

## Key finding: the demo simulator is the only writer of renderable data

`readScopedData` (`server/routes/process.ts:2110` region) resolves everything the `/app` UI renders
by starting from `pm_session` and returning `emptyScopedData()` when no session rows match the
channel scope. The only `INSERT ... INTO pm_session` in the codebase is in `persistDemoSnapshot`
(`server/routes/process.ts:2494`), reached exclusively from `POST /api/sim/run`.

Real Slack ingestion writes `pm_message`, `pm_processing` and `pm_journal` rows
(`server/slack-observations.ts`) with a synthesised `ses_slack_` session id built from workspace, channel and root timestamp,
but never creates the corresponding `pm_session` row. Deleting the demo path therefore yields an app
that renders nothing, for any Slack workspace, regardless of message volume.

## Verified gaps in the real-data pipeline

1. **No session segmentation.** Nothing groups ingested Slack messages into `pm_session` rows. Each
   message currently derives its own thread-rooted session id that has no backing row.
2. **No production extraction.** `pm_processing` rows are written as `pending`. The Durable Object's
   `extraction` deadline has no default hook (`server/channel-coordinator.ts`, `defaultHook` returns
   `undefined` for every kind except `recovery`), so nothing ever consumes them. The only path from
   messages to `pm_step` is `persistDemoSnapshot`.
3. **Extraction model is a keyword matcher.** `/api/sim/run` runs `runDemoReadinessGate`, whose
   `TranscriptExtractionModel` (`server/demo/readiness.ts:450`) is a hard-coded phrase matcher keyed
   to the checked-in transcripts ("opened inc-4412", "emailed vertex", "biggest logo"). It is not a
   model call and cannot generalise to arbitrary Slack text.
4. **The real model adapter is unreachable.** `createOpenRouterModelAdapter` is used only by
   `triggerExtraction` in `server/agent/tools/index.ts`, which is referenced by `tests/agent-tools.test.ts`
   and by no route, cron or Durable Object hook. It also returns extracted steps without persisting
   them to `pm_step`.
5. **No Slack Web API client at all.** The repository contains no `chat.postMessage`, `users.info`,
   `conversations.history` or any other Slack Web API call. Consequences: the agent cannot post back
   (`postToSlack` queues into `pm_outbox`, and no drainer exists); Slack user ids are never resolved
   to people, so `author_person_id` stays null and `author_label` stays a raw `U…` id for real
   messages; and there is no channel backfill, so only messages arriving after install exist.

## Demo and synthetic surface inventory

Delete-only assets (~6,500 lines):

- `shared/fixtures.ts` (1,605) — fictional people, projects, sessions, messages, steps, graphs.
- `server/demo/readiness.ts` (1,093) — readiness gate plus the keyword extraction model.
- `server/demo/simulator.ts` (764) — scenario/transcript generation.
- `fixtures/contracts/spec08-compatibility.ts` (633) and `shared/fixture-validation.ts` (490).
- `migrations/0002_seed.sql` (316) — 316 baseline synthetic `events` rows.
- `shared/simulation.ts` (161) — legacy synthetic event generator (Maya Chen, Oliver Park, …).
- `src/demo-walkthrough.ts` (116) — guided auto-play walkthrough.
- `fixtures/transcripts/*.json` (254) and `kb/` (1,199) — Helios Payments / Atlas Self-Serve Billing,
  six fictional personas, their authored policies and designed workflows.
- Scripts: `scripts/seed.ts`, `scripts/generate-demo-transcripts.ts`, `scripts/check-demo-readiness.ts`,
  `scripts/validate-fixtures.ts`, plus the `seed:generate`, `sim:generate`, `sim:readiness` and
  `fixtures:validate` package scripts.

Code that must be reworked rather than deleted:

- `server/index.ts` — the legacy simulation API (`/api/simulate`, `/api/model*`, `/api/context`,
  `/api/ask`) is built on the three hard-coded `vendor`/`refund`/`access` workflows in
  `shared/process.ts`, reports `source: "simulation"`, and `/api/context` literally returns
  "Synthetic data; no live Slack connection." as a limitation string.
- `server/routes/process.ts` — `DEFAULT_PROJECT_ID = "proj_helios"`; `resolveScope` validates every
  `project_id` against the checked-in fictional KB, so a real customer project cannot exist.
  `/api/sim/run`, `/api/sim/pause`, `/api/sim/resume` must go.
- `server/kb.ts` — loads the fictional KB from checked-in JSON via import attributes. Needs to read
  authored workflows from D1 (`pm_kb_*` tables from migration 0007 already exist) instead.
- `src/app.tsx` — 48 demo references: "Run demo mode" and "Run" primary actions, the "Real pipeline
  demo" sidebar card, the guided walkthrough overlay, `data-demo-target` attributes, keyboard demo
  shortcuts, `projectFallbacks` naming Helios and Atlas, and `defaultScope` pinned to
  `proj_helios` / `wf_p1_incident`.
- `src/api.ts` — `createFixtureApiAdapter` and `createClientFixtures` (test-only, but exported from a
  client module that imports `shared/fixtures.ts`).
- `src/homepage.tsx`, `src/auth-gate.tsx`, `src/components/app-shell/app-shell.tsx` — copy that
  promises "Interactive demo · Simulated data · No setup needed", "It uses simulated workflows; live
  Slack ingestion is still to come", "Process data in this demo is simulated", "About this demo".
- `wrangler.jsonc` — `SLACK_ALLOWED_TEAM_ID: "T_ARIADNEOS_DEMO"` and
  `SLACK_ALLOWED_CHANNEL_ID: "C_HELIOS_OPS"` in both staging and production vars are placeholders, so
  `configuredChannelScope` scopes the whole app to a workspace that does not exist. Worker and D1 are
  also both named `ariadneos-demo`.
- `docs/demo.md`, `docs/SCOPE.md` and several work items describe the synthetic organization as the
  product.

## Data isolation problems that block real customer data

- `pm_message` has no provenance column (`migrations/0005_pm_foundation.sql:145`), so simulated and
  real messages are indistinguishable once written. `pm_session.source` distinguishes them, but
  `scopeSnapshot` rewrites demo rows to the configured production workspace and channel before
  insert, and fabricates permalinks into a Slack workspace that is not the customer's.
- `/api/sim/run` is callable by any authenticated user, so any signed-in account can inject fabricated
  sessions, messages, steps and evidence into the production channel scope.
- There is no tenant model. Every authenticated Slack user, from any workspace, reads the single
  server-configured `SLACK_ALLOWED_TEAM_ID`/`SLACK_ALLOWED_CHANNEL_ID` scope. Slack login via Better
  Auth is genuine, but nothing ties the signed-in user's workspace to the data they can see.
- Slack login is user-level OIDC only. There is no workspace install (OAuth v2 bot scopes), no
  `SLACK_BOT_TOKEN` acquisition flow, and no per-install token storage.

## Acceptance criteria

These describe the future implementation wave. This audit pass meets none of them; it
establishes them as the target.

- No file under `src/`, `server/`, `shared/`, `kb/`, `fixtures/` or `migrations/` contains fictional
  organizations, personas or synthetic event generators.
- Messages posted in a configured real Slack channel appear in `/app` with working permalinks,
  real author names, extracted steps and evidence, with no simulator invocation.
- A user can define their own workflow/process; `project_id` is validated against tenant data in D1
  rather than checked-in JSON.
- Demo-only routes (`/api/sim/*`, `/api/simulate`) and their UI controls are gone.
- Marketing, auth-gate and in-app copy make no claim of simulated data.
- `npm run check:repo` passes with the demo-dependent tests replaced by real-pipeline tests.

## Decisions and rationale

- Recorded the audit before changing code. Removing the ~6,500 demo lines is mechanically easy, but it
  would take the deployed app from "shows a convincing synthetic process" to "shows nothing", because
  of the five pipeline gaps above. The sequencing decision (build the real pipeline first, remove demo
  content second) is the requester's call and is flagged rather than assumed.
- Did not delete `kb/` in this pass. It is simultaneously demo content (Helios, Atlas, six personas)
  and the structural backbone of designed-vs-discovered conformance scoring. It needs replacement by
  tenant-authored workflows in D1, not a straight deletion.

## Changes

- Added this work item. No application code changed.

## Validation

- `npm ci` then `npm run test` — 27 files, 209 tests passed (2026-09-14).
- Static verification of the claims above by reading the named files and by exhaustive greps for
  `INSERT ... pm_session`, `pm_outbox`, `slack.com/api`, `chat.postMessage`, `createOpenRouterModelAdapter`
  and `agent/tools`. Each gap listed is a "no results outside tests" finding, not an inference.
- Not run: `npm run check:repo`, browser smoke, staging verification. No behavior changed in this pass.

## Risks and rollback

- Nothing to roll back; documentation only.
- Risk in the follow-up wave: roughly 1,617 lines of the 209-test suite are written against fixtures
  and the demo readiness gate (`tests/demo-readiness.test.ts`, `tests/fixtures.test.ts`,
  `tests/spec08-compatibility.test.ts`, `tests/client-state.test.ts`, `tests/inspector.test.ts`,
  `tests/process-canvas.test.ts`). Deleting fixtures without writing replacement tests against real
  ingestion would silently lower coverage of the mining and UI paths, which
  `docs/code-quality.md` forbids.

## Next steps

- Requester decides sequencing: build the real ingestion → session → extraction → graph path first,
  or strip demo content immediately and accept an app that renders nothing until the pipeline lands.
- If building first, the ordered work is: (1) Slack Web API client plus workspace install with bot
  token storage; (2) session segmentation writing `pm_session`; (3) extraction worker draining
  `pm_processing` through `createOpenRouterModelAdapter` and persisting `pm_step`/`pm_step_evidence`;
  (4) person resolution via `users.info`; (5) tenant-authored workflows in the existing `pm_kb_*`
  tables replacing `kb/`; (6) outbox drainer for agent replies; (7) demo content removal and copy
  rewrite; (8) real scope configuration in `wrangler.jsonc` and renaming the `ariadneos-demo`
  Worker/database.
- Each of (1)–(8) is a separately assignable issue; none of them is blocked by the others except
  (3) on (2) and (6) on (1).
