# Persist designed-graph edits

Status: in-review
Owner: Codex / SAM task 01M2AYXZG5DDC7HWK19F38ZF7J
Source: User request to implement GitHub issue #34 as “Persist designed-graph edits through D1 with revision history.” Current GitHub issue #34 is titled “Expose graph repair toolbar and an undoable reconciliation diff,” while issue #33 contains the matching edit persistence/API scope. This work follows the user and SAM task scope and will reference the mismatch for reviewers.
Branch: sam/implement-github-issue-34-38zf7j
PR: https://github.com/raphaeltm/ariadneos/pull/75

## Intent
Add D1-backed designed-graph edit persistence for scoped workflow edits, keep immutable authored KB data as the base model, reduce an ordered audit log into the effective designed graph, and return revisioned graph/conformance responses through authenticated process APIs.

## Acceptance criteria
- Additive D1 migration stores scoped graph edit revisions, request ids, actor, payload, undo state, and conflict metadata without mutating authored KB rows.
- Authenticated API supports add/remove/merge nodes and edges, revision history listing, undo, idempotent request ids, and stale base-revision rejection.
- Overlay/designed graph and conformance responses use the effective designed model after stored edits, including merge rewrites for observed evidence.
- Regression tests cover persistence, conflict handling, idempotency, illegal edit validation, and undo history.

## Decisions and rationale
- Use a scoped append-only edit revision table plus an `undone` marker on target edits so undo has its own audit row while the reducer can ignore undone edits.
- Treat stale `base_revision` as a 409 conflict with the current revision. Requests without `base_revision` append to the current head for generated clients that cannot yet supply a revision.
- Keep authored KB JSON immutable and reduce edits at request time for demo scale. This matches spec 09 and avoids introducing a second persistence path.

## Changes
- Added `migrations/0008_graph_edit_revisions.sql` with scoped `pm_graph_edit_revision` rows, per-workflow revision uniqueness, idempotent request ids, undo target tracking, actor, timestamps, payloads and conflict metadata.
- Added `shared/model-edits.ts` to reduce authored designed workflows plus ordered edits into an effective designed workflow, including node add/remove/rename/merge, edge add/remove, merge rewrites for observed steps, matrix rebuilds and undo filtering.
- Added `server/model-edits.ts` for D1 edit history reads, active-edit reads, idempotent appends and undo revision writes.
- Added authenticated `/api/model/edit`, `/api/model/edit/undo` and `/api/model/edits` routes. Edit writes validate action-specific legality server-side, reject stale `base_revision` with 409, preserve idempotent request retries, recompute graph/conformance from D1-backed edits, and persist the recomputed overlay graph through the existing graph revision layer.
- Threaded the effective designed workflow into snapshot, designed/overlay/instance graph, session conformance and graph rebuild responses.
- Added reducer and process API tests for persistence, conflict handling, idempotency, undo, edge edits, merge rewrites and governed removal acknowledgement.

## Validation
- `npm ci`: passed; installed locked dependencies.
- `npm run fix`: initially reported lint issues in new code, then passed after refactoring validation helpers and formatting.
- `npm exec -- vitest run tests/process-routes.test.ts`: passed, 10 tests.
- `npm exec -- vitest run tests/model-edits.test.ts tests/process-routes.test.ts`: passed, 12 tests.
- `npm run typecheck`: passed.
- `npm run check`: passed; lint, typecheck, fixture validation, 138 coverage tests, guardrail probes, migration smoke and production build.
- Initial `npm run check:repo`: failed because `ruff` was not installed; after installing Ruff 0.16.7 locally for validation, the next run reached Playwright and failed because Chromium was not installed.
- `npm exec --no -- playwright install --with-deps chromium`: passed; installed the browser and required system dependencies in the workspace environment.
- `PATH="/workspaces/ariadneos/.local-tools:$PATH" npm run check:repo`: passed after the environment setup; included Python work-item tests, all work-item context, Ruff, full app checks, dependency audit, isolated Worker/D1/API smoke with migration `0008_graph_edit_revisions.sql`, and 6 Chromium browser tests.
- `PATH="/workspaces/ariadneos/.local-tools:$PATH" python3 scripts/check_quality.py`: passed; same quality suite, isolated D1/API smoke and 6 Chromium browser tests.
- `python3 scripts/check_work_items.py --base origin/main`: initially reported that new work-item files must be staged; passed after staging the PR candidate files.

## Risks and rollback
- The live UI work is still in progress, so endpoints are validated by API tests rather than a deployed toolbar flow.
- Rollback: revert the migration, reducer, route changes, tests, and this work item.

## Next steps
- Open the PR, monitor CI, and merge only when required checks are green. Staging verification is intentionally skipped per user request for this time-critical task.
- Monitor PR #75 checks and merge only when required checks are green.
