# Deterministic Instance And Aggregate Graph Mining

Status: in-review
Owner: Codex, requested by repository owner
Source: GitHub issue #20 and SAM task 01M2ATAWA04DE5XKNWCZH082AA. Implement pure graph mining helpers for scoped aggregate and instance process views, without route or database coupling.
Branch: sam/implement-github-issue-20-h082aa

## Intent
Add deterministic graph mining for accepted process steps so downstream runtime and UI work can rebuild aggregate overlays, instance graphs, layout inputs and graph diffs from typed in-memory data. Keep the work scoped to `shared/mining/graph.ts`, `shared/mining/layout-data.ts` and behavior tests.

## Acceptance criteria
- Only `done` + `confirmed` + non-negated steps contribute observed support; rejected, proposed, skipped, abandoned and negated steps are excluded.
- Repeated visits increase occurrences but not distinct-session support, and Helios/Atlas scopes do not share observed counts.
- Designed membership produces ghost nodes and designed edges; rejected final observations remove discovered-only nodes/edges or return designed activities to ghosts.
- Edge kind precedence is deterministic, DFS back-edges/rework stay out of the layout DAG, designed probabilities are preserved, and the happy path is stable.
- Pure rebuild over five sessions and 2,000 steps is measured against the 50 ms target.

## Decisions and rationale
- Start from current `origin/main`; issue #14 is open as PR #52 and issue #31 remains open, so this branch records the required future rebase instead of depending on unmerged contracts.
- Implement the mining core as pure TypeScript functions with local input contracts because the owned modules do not exist on main yet and SQL/API contracts are explicitly out of scope.
- Keep revisioning and diff helpers scoped to aggregate nodes/edges, with compact revision fingerprints, so the pure rebuild remains deterministic without making revision hashing proportional to every instance step object.
- Treat rework and DFS back-edges as layout annotations: aggregate edges retain them, but `buildLayoutData()` excludes them from the DAG edge set used for deterministic ranks.

## Changes
- Added `shared/mining/graph.ts` with typed pure inputs and builders for accepted-step aggregate graphs, instance step graphs, variants, happy path, edge kind classification, designed overlay merge, revision hashes and aggregate diff helpers.
- Added `shared/mining/layout-data.ts` with deterministic DAG layout data, back-edge/rework annotation separation and an acyclicity helper.
- Added graph behavior tests covering scoped Helios/Atlas isolation, repeated-visit support semantics, lifecycle/curation exclusions, edge kind precedence, designed ghosts, rejection diffs, layout acyclicity, designed probabilities, variants, happy path and 2,000-step rebuild timing.

## Validation
- `npm ci` passed and installed locked JS dependencies.
- `npm run fix` passed after refactoring Biome complexity findings; no fixes remained on the final run.
- `npx vitest run tests/mining-graph.test.ts` passed: 8 tests.
- `npm run typecheck` passed.
- `npm run check` passed: Biome lint, strict TypeScript, coverage tests (56 tests), guardrail probes and production build.
- `python3 scripts/check_work_items.py --base origin/main` passed after staging this task's files.
- `PATH=/workspaces/ariadneos/.local-tools/ruff-x86_64-unknown-linux-gnu:$PATH python3 scripts/check_quality.py` passed in full after installing the pinned Ruff 0.16.7 binary and documented Playwright Chromium dependencies in the environment: Python work-item tests, work-item context, Ruff check/format, `npm run check`, dependency audit, isolated API/D1 smoke and five Chromium browser tests.
- Standalone pure rebuild timing for five sessions and 2,000 steps after warmup: samples `[33.61, 10.95, 10.88, 10.83, 14.16]` ms; best sample 10.83 ms, under the 50 ms target.

## Risks and rollback
- Risk: #14 or #31 may introduce overlapping shared contracts after this branch starts. Rebase this branch when those changes merge and adapt only the public input adapters if needed.
- Local full-quality setup required downloading Ruff 0.16.7 and Playwright Chromium/system dependencies because the base image lacked them. The first full-quality attempts failed only on missing `ruff`, then missing browser binaries/libraries; the final rerun passed.
- Rollback: revert this PR; it adds pure modules and tests only, with no schema, route, deployment or runtime side effects.

## Next steps
- Open a PR with `Closes #20`, monitor CI. Staging verification is intentionally skipped per the user request for this time-critical pure-module task.
- Rebase on issue #14/#31 work when their PRs merge, if they land before this branch merges.
