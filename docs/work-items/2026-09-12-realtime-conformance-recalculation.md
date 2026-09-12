# Real-time conformance recalculation

Status: in-progress
Owner: Codex, requested by the repository owner through SAM task 01M2AZCRR5GQTYR6PMHYVDHQVC
Source: User/SAM task for GitHub issue #36, "Add real-time conformance recalculation on graph edit and curation changes." `gh issue view 36` currently returns a different title/body, "Add scoped workspace workflow links and breadcrumb drill-down"; this work follows the explicit user/SAM task scope.
Branch: sam/implement-github-issue-36-vdhqvc

## Intent
Add a server-side real-time conformance recalculation pipeline that recomputes only the affected workflow/session scope when graph or curation mutations occur, journals updated conformance results, and makes them available to SSE clients without requiring a full snapshot rebuild.

## Acceptance criteria
- Curation status changes recompute conformance for the affected session/workflow and return the updated session/workflow conformance in the API response.
- Recalculation uses the affected project/workflow/session scope and the existing pure conformance scorer instead of rebuilding unrelated workflows.
- Updated conformance entries are appended to the process journal so connected SSE clients receive current scores.
- The recalculation helper is reusable by graph-edit routes when issue #32 lands, and graph rebuild responses can include recalculated conformance for their scoped workflow.
- Regression tests cover curation-triggered recalculation, incremental scoping, and conformance journal payloads.

## Decisions and rationale
- Implement the owned pipeline in the current process route layer because `main` already has authenticated process routes, D1-backed sessions/steps/messages, journal SSE replay, and the conformance scorer.
- Keep graph-edit integration as a reusable helper and response contract until the graph-edit endpoint merges; current `main` has no `/api/model/edit` or edit log route to wire directly.
- Journal session and workflow conformance as individual events so clients can upsert scores incrementally rather than treating every mutation as a snapshot-required reset.

## Changes
- Added an internal channel-coordinator `/broadcast` path that reads an already committed journal row and fans it out to connected SSE streams.
- Added process-route journal publishing through the shared journal writer, then broadcasts newly inserted step, graph-delta, and conformance events to connected clients.
- Added scoped conformance recalculation for curation changes and graph rebuilds. Curation updates now recompute the affected workflow, persist the affected session summary fields, return session/workflow conformance in the API response, and journal both conformance payloads.
- Added regression coverage for curation-triggered recalculation, conformance journal rows, session summary persistence, and broadcasting an existing conformance journal row to an active SSE stream.

## Validation
- `npm ci` passed; 232 packages installed and 0 vulnerabilities reported.
- `npm exec -- vitest run tests/process-routes.test.ts tests/channel-coordinator.test.ts` passed: 2 files, 10 tests.
- `npm exec -- tsc --noEmit` passed.
- `npm run fix` passed and applied safe formatting to one file.
- `npm run check` passed: Biome lint, TypeScript, fixture validation, coverage with 16 files and 133 tests, guardrail probes, PM migration check, and production build.
- `python3 scripts/check_work_items.py --base origin/main` initially failed because the new work item had not been staged yet; rerun passed after staging.
- First `PATH=/tmp/ariadneos-tools/ruff-x86_64-unknown-linux-gnu:$PATH npm run check:repo` reached browser tests and failed because Playwright Chromium was not installed in the container.
- `npm exec --no -- playwright install --with-deps chromium` passed and installed Chromium/headless shell plus required system packages.
- `PATH=/tmp/ariadneos-tools/ruff-x86_64-unknown-linux-gnu:$PATH npm run check:repo` passed after browser installation, including Python gates, Ruff, app checks, dependency audit, isolated Worker/D1 smoke, and 6 Chromium tests.
- `PATH=/tmp/ariadneos-tools/ruff-x86_64-unknown-linux-gnu:$PATH python3 scripts/check_quality.py` passed, including the same quality suite and 6 Chromium tests.

## Risks and rollback
- Current `main` does not yet include the graph-edit endpoint from issue #32, so direct graph-edit integration is a reusable server helper plus graph rebuild wiring. When #32 lands, its edit route should call `recalculateScopedConformance` after applying a designed-graph edit.
- Roll back by removing the coordinator broadcast endpoint, process-route recalculation/publishing helper, route response additions, tests, and this work item.

## Next steps
- Open a PR with `Closes #36`, monitor CI, and merge when green. Staging verification is intentionally skipped per the user's time-critical instruction.
