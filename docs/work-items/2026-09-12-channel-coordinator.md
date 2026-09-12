# Channel coordinator Durable Object

Status: in-review
Owner: Codex via SAM task 01M2AT9WPZ83WB0C47T7XDZVHB for Raphael
Source: GitHub issue #16 asks for a SQLite-backed channel coordinator Durable Object with durable scheduling, committed-journal SSE fanout/replay, recovery, and isolated staging/production bindings.
Branch: sam/implement-github-issue-16-xdzvhb

## Intent
Add the runtime foundation for one coordinator Durable Object per configured workspace/channel. The object should persist schedule, pause, checkpoint and committed-journal state, serialize channel mutations, fan out and replay SSE events from committed records, recover pending D1 work, and expose typed hooks without adding Slack API calls, extraction prompts, graph algorithms, simulator content or UI.

## Acceptance criteria
- Alarm retry or restart with fake hooks does not duplicate journal operations, and an empty or paused schedule does not spin.
- Two SSE streams receive identical committed journal IDs, reconnection replays gaps, and expired cursors emit a reset.
- Wrangler local and dry-run configuration validates Durable Object bindings, with staging and production using separate class migrations/namespaces.
- Existing deployment gates and demo/auth behavior remain intact.

## Decisions and rationale
- Use D1 as the authoritative committed journal and pending-work store, with Durable Object SQLite storage for operational scheduling and replay cursors. This follows the Cloudflare implementation contract and avoids creating a second graph database.
- Keep runtime changes additive behind `/api/snapshot` and `/api/stream` so existing demo/auth routes continue to work until later consumers migrate.
- After #14 merged, reuse its `0005_pm_foundation.sql` `pm_journal`, `pm_processing` and `pm_outbox` tables instead of redefining them. This branch now adds only `0006_channel_coordinator_runtime.sql` indexes and runtime behavior.

## Changes
- Extended the merged `pm_journal`, `pm_processing` and `pm_outbox` foundation tables with coordinator runtime indexes for committed journal replay, pending-work recovery and recoverable outgoing intent state.
- Added `server/channel-coordinator.ts` with a SQLite-backed Durable Object core that serializes channel mutations, persists deadlines/checkpoints/status, multiplexes recovery/extraction/beat/close deadlines onto one alarm, commits journal entries idempotently by operation key, and fans out/replays SSE frames with reset, heartbeat, stream rotation, subscriber limits and abort cleanup.
- Added `server/runtime/channel.ts` with typed coordinator scopes, journal envelopes, feature hooks, replay helpers and Worker-to-DO routing helpers.
- Wired authenticated `/api/snapshot` and `/api/stream` routes through the coordinator while preserving existing demo/auth routes. Slack message events now also create pending `pm_processing` rows and wake the matching coordinator after durable storage.
- Added Wrangler Durable Object binding and a SQLite class migration at the top level and in staging/production environments; staging and production keep distinct Worker names and D1 database IDs.
- Added regression coverage for retried alarms, multi-stream committed ID agreement, reconnect replay gaps, expired cursor resets, Slack pending-work rows and binding isolation.

## Validation
- `npm ci` passed.
- `npm run typecheck` passed.
- `npx vitest run tests/channel-coordinator.test.ts tests/slack-events.test.ts tests/deployment-config.test.ts` passed after rebasing on #14: 21 tests.
- `npm run fix` passed after manual style cleanup.
- `npm run check` passed after rebasing on #14: Biome/Ultracite lint, strict TypeScript, fixture validation, 87 coverage tests, guardrail probes, PM migration smoke and production build.
- First `npm run check:repo` attempt failed because `ruff` was not installed. Installed pinned Ruff 0.16.7 to `/home/node/.local/bin/ruff`.
- Second `npm run check:repo` attempt failed only because the Playwright Chromium binary was missing from `/home/node/.cache/ms-playwright`. Ran `npm exec --no -- playwright install --with-deps chromium`.
- Final `PATH="/home/node/.local/bin:$PATH" npm run check:repo` passed after rebasing on #14: work-item gates, Ruff, full app checks, dependency audit, PM migration smoke, isolated local Worker/D1 smoke with migrations through `0006_channel_coordinator_runtime.sql`, and 5 Chromium browser tests.
- `npx --no-install wrangler deploy --dry-run --env staging` passed and showed `CHANNEL_COORDINATOR (ChannelCoordinator)` plus staging D1 `ariadneos-staging`.
- `npx --no-install wrangler deploy --dry-run --env production` passed and showed `CHANNEL_COORDINATOR (ChannelCoordinator)` plus production D1 `ariadneos-demo`.
- Staging deployment verification was not run, per the user's time-critical instruction to skip staging verification for this issue.

## Risks and rollback
- Runtime hooks are foundation stubs; extraction, Slack Web API posting, graph deltas and simulator content remain owned by later issues. Roll back by reverting this PR and applying no new migration to undeployed environments; if migrated, the new additive `pm_` tables can remain unused safely.

## Next steps
- Open the PR with `Closes #16`, watch CI to green, and merge only after required checks pass. Staging verification remains intentionally skipped for this issue per the user instruction.
