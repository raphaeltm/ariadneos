# D1 Graph And KB Persistence

Status: in-review
Owner: Codex, requested by repository owner
Source: User assignment to implement GitHub issue #18 as "Persist graph revisions and KB state in D1 with conflict-free merge." Current GitHub issue #18 metadata still describes simulator run controls, so this work follows the explicit assignment text and records the mismatch for review.
Branch: sam/implement-github-issue-18-zkvp97

## Intent
Add D1-backed persistence for authored KB state and deterministic graph revisions so downstream APIs and the channel coordinator can store snapshots, deltas and replayable graph updates without treating mutable in-memory graph state as authoritative.

## Acceptance criteria
- D1 migrations create the missing authored KB state tables consumed by the merged KB seed helpers, and seeding remains idempotent while preserving non-authored rows.
- Graph revisions persist per scoped view with monotonically increasing revisions, full snapshots, deltas from the current stored head and idempotent operation keys.
- Stale writers merge against the current stored head instead of overwriting newer revisions or rejecting compatible deterministic graph states.
- Regression tests cover KB idempotency, graph no-op commits, stale-base merge behavior and snapshot/delta reads.

## Decisions and rationale
- Start from current `origin/main`, which already includes merged PRs for #14, #15, #16 and #20.
- Keep the implementation inside D1/server persistence and tests; do not mount new user-facing API routes in this PR because issue #22 owns API composition.
- Use operation keys and graph content hashes for idempotency, and compute deltas from the current persisted head so retrying or racing rebuilds is conflict-free at the graph-view boundary.

## Changes
- Added migration `0007_graph_kb_persistence.sql` with additive authored KB tables, a KB state table, scoped graph view heads and immutable graph revision rows storing snapshots and deltas.
- Added `server/graph-persistence.ts` with view-key generation, graph head/revision/delta reads and idempotent graph revision commits. Commits dedupe operation retries, no-op identical heads and diff each new commit from the current stored head.
- Extended `server/kb.ts` so `seedKb()` writes a deterministic authored KB state hash and summary row while keeping the existing authored upsert behavior.
- Extended the migration smoke check to require the new KB and graph persistence tables.
- Added regression coverage for KB state idempotency, graph snapshot/delta storage, operation-key retries, same-content no-ops, stale-writer merge behavior and historical revision reads.

## Validation
- `npm ci`: passed; installed locked dependencies.
- `npm run fix`: passed after initial formatting/lint fixes; final run reported no fixes.
- `npm exec vitest run tests/kb.test.ts tests/graph-persistence.test.ts`: passed, 11 tests.
- `npm run typecheck`: passed.
- `npm run check`: passed; lint, typecheck, fixture validation, 109 coverage tests, guardrail probes, migration smoke and production build.
- `PATH=/workspaces/ariadneos/.local-tools/ruff-x86_64-unknown-linux-gnu:$PATH npm run check:repo`: passed after installing Ruff 0.16.7 and Playwright Chromium in the environment; includes Python work-item tests, all work-item context, Ruff, full app check, dependency audit, isolated Worker/D1 smoke with all seven migrations, and 5 Chromium browser tests.
- `PATH=/workspaces/ariadneos/.local-tools/ruff-x86_64-unknown-linux-gnu:$PATH python3 scripts/check_quality.py`: passed with the same full quality suite.
- Earlier `npm run check:repo` attempts failed only on missing local tooling: first `ruff` was absent, then Playwright Chromium was absent. Both were installed before the passing rerun.

## Risks and rollback
- Risk: the live GitHub issue #18 title/body does not match this assignment text. Reviewers should verify whether `Closes #18` is still desired before merge.
- Risk: this PR provides persistence helpers and schema only; issue #22 still owns route composition and live API wiring.
- Rollback: revert this PR; planned changes are additive migrations, isolated persistence helpers and tests.

## Next steps
- Run the direct `python3 scripts/check_quality.py` command requested by the user, open a PR with `Closes #18`, monitor CI, and merge only after required checks are green. Staging verification is intentionally skipped per the user's explicit instruction for this time-critical task.
