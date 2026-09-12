# Typed snapshot and SSE client

Status: in-progress
Owner: Codex agent for SAM task 01M2ATDY84XGKRH0Z5JM1SYECC
Source: GitHub issue #23, "Build typed snapshot/SSE client and app state against fixtures"
Branch: sam/implement-github-issue-23-1syecc

## Intent
Build typed frontend API, snapshot, SSE, and state modules that can run against fixture-backed data now and keep component contracts stable when the production API lands. The work covers scoped view selection, sessions, messages, steps/evidence, graph revisions, connection state, ordered idempotent event application, reset/reconnect behavior, and issue #31 DTO concepts without changing the app shell or routes.

## Acceptance criteria
- Fresh snapshot state and disconnect/replay fixture state converge to the same final client state, with duplicate events harmless.
- Rejected node/edge removal and return-to-ghost updates apply correctly through graph deltas.
- Project or workflow switch ignores stale requests/events, and revision mismatch/reset triggers a fresh snapshot.
- `npm run fix`, `npm run check`, `npm run check:repo`, and the work-item context check have recorded outcomes before handoff.

## Decisions and rationale
- Build in `src/api.ts`, `src/sse.ts`, and `src/store.ts` so later UI work can consume narrow selectors/actions without adopting a new state library.
- Use a fixture adapter first because the production snapshot/SSE API is not on `main`; keep adapter boundaries identical to the production client contract.
- After PR #14 merged into `main`, rebase and consume `shared/contracts.ts` plus `shared/fixtures.ts` rather than redefining the core graph/message/session/step DTOs in the client. Keep only client-specific scope, agent-card and pipeline-log DTOs in `src/api.ts`.
- Treat graph revision mismatch and explicit reset as snapshot-required effects instead of silently accepting out-of-order topology updates.

## Changes
- Added `src/api.ts` with typed production and fixture adapters for snapshot fetches, stream URL construction, step status updates, simulation run/pause/resume and ask. The fixture adapter normalizes the shared contract snapshot with client-only agent and pipeline arrays.
- Added `src/store.ts` with pure state initialization, snapshot application, ordered idempotent journal event application, graph delta handling, stale-scope guards and narrow selectors for graph, connection, sessions, messages, steps and evidence.
- Added `src/sse.ts` with an EventSource wrapper for explicit `after` reconnects, native cursor tracking, duplicate/stale event suppression, reset callbacks, hidden-page stream cleanup and bounded exponential backoff.
- Added `tests/client-state.test.ts` covering snapshot/replay equivalence, duplicate replay, rejected discovered-node removal, designed ghost restoration, stale request/event protection, revision mismatch reset, fixture adapter parity and SSE cursor/visibility behavior.

## Validation
- `npm ci`: passed after installing locked npm dependencies.
- `npm run fix`: initially failed before `npm ci` because `ultracite` was unavailable; passed after dependencies installed. Reran after rebase/refactor; passed and formatted the changed files.
- `npm run test -- tests/client-state.test.ts`: passed, 8 tests.
- `npm run check`: passed lint, typecheck, coverage tests, guardrail probes and production build.
- `npm run check:repo`: initially failed because Ruff was missing, then because Playwright Chromium and system libraries were missing. Installed Ruff 0.16.7 from the official release archive and installed Playwright Chromium plus its system dependencies. Final rerun passed work-item checks, Ruff, `npm run check`, dependency audit, isolated Worker/D1 smoke and 5 Chromium browser tests.
- After rebasing on merged PR #14, `npm run check` passed with fixture validation and migration smoke included. A parallel `check` and `check:repo` attempt failed because both Vitest runs tried to write the same coverage directory; rerunning sequentially resolved it.
- Final post-rebase `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed work-item checks, Ruff, `npm run check`, dependency audit, isolated Worker/D1 smoke including `0005_pm_foundation.sql`, and 5 Chromium browser tests.
- `python3 scripts/check_work_items.py --base origin/main`: passed after staging the work-item file; earlier unstaged run correctly failed with "Add or update a dated docs/work-items/*.md record (stage new files locally)."

## Risks and rollback
- The production snapshot/SSE API is still pending, so production adapters are typed but not exercised against live endpoints in this PR. The fixture adapter and reducer tests pin the component-facing contract until the runtime lands.
- PR #31 does not exist as a pull request at the time of this update; rebase on that work if it lands before merge. Roll back by reverting this branch; no schema, route, app shell or deployment changes are included.

## Next steps
- Commit, push, open a PR with `Closes #23`, and monitor CI.
