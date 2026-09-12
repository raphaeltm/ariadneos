# Graph canvas drag/drop and inline editing

Status: in-review
Owner: Codex agent for SAM task 01M2AY4V9EHZKTXN7MJVMQFJJX
Source: GitHub issue #33 asks for designed-edge drag/drop and inline label editing on the graph canvas, integrating with the current canvas and graph edit operation surface.
Branch: sam/implement-github-issue-33-mqfjjx

## Intent
Add graph-canvas interactions for creating or moving designed edges and renaming node or edge labels inline, with clear drag feedback and focused integration with the edit operation APIs available on current main.

## Acceptance criteria
- Users can create a designed edge by dragging from one graph node to another, with visual feedback during the drag and a persisted graph edit operation.
- Users can move an existing designed edge endpoint by dragging from an edge endpoint to a different node, with visual feedback and a persisted graph edit operation.
- Users can rename node labels and designed edge labels inline from the canvas, with keyboard commit/cancel behavior.
- The implementation preserves existing graph rendering, selection and evidence behavior while adapting to current main's available #32/#24 surfaces.
- Required checks run: `npm run fix`, `npm run check`, `npm run check:repo`, and `python3 scripts/check_quality.py`.

## Decisions and rationale
- Started from `origin/main` at 4b1fd80, then rebased through newer `origin/main` commits including 08b87e5, 22564d5, b34d874, and b16d4d4, and ded9915 after canvas, curation, graph persistence, agent-memory, runtime settings, agent tools, graph editing surface, and agent chat work merged while this task was in progress.
- The live GitHub issue #33 body currently describes the broader edit API foundation and excludes canvas UX, while the SAM task/user prompt asks for designed-edge drag/drop and inline editing. This branch implements a narrow end-to-end canvas slice with a session-scoped legacy edit log so the UI works on current main without taking over the broader `pm_*` edit foundation.
- Keep node positions dagre-driven. Dragging creates or moves designed edges only; freeform node position changes are not persisted.
- Give React Flow explicit custom-node dimensions, a deterministic initial viewport, and delayed fit-view passes after init. Browser smoke showed the model and inspector could load before ResizeObserver measured custom nodes, leaving graph nodes hidden; the explicit dimensions keep the graph layer actionable on first load and reload.
- Give the graph editing browser test its own provisioned auth session so its rename/edge edits do not share state with the simulation persistence browser test.

## Changes
- Work item created before implementation.
- Added `0009_graph_canvas_edits.sql` for authenticated session/workflow-scoped canvas edit history after `main` introduced migrations 0007 and 0008.
- Added shared graph canvas edit DTOs and an effective-model reducer that overlays node labels, edge labels, designed-edge creation and designed-edge endpoint moves over mined observations.
- Added `/api/model/canvas-edits`, `/api/model/canvas-edit`, and `/api/model/canvas-edit/undo` routes for the current synthetic `/api/model` surface, with server-side action and endpoint validation. These routes avoid shadowing `main`'s curation client fallback on `/api/model/edit`.
- Updated the current `WorkflowCanvas` graph canvas to support React Flow drag-to-connect, designed-edge reconnect, inline node and edge label editing, selected edge labels, curation controls from current main, deterministic reload rendering, and drag visual feedback.
- Updated the app to persist canvas edits and refresh the visible model from the server response.
- Added reducer and request-boundary regression tests, and expanded auth-boundary coverage to the new edit routes.
- Added `0009_graph_canvas_edits.sql` to the agent-memory route test fixture so `/api/ask` can read the edited effective model in narrow SQLite fixtures.

## Validation
- `npm ci`: passed after the latest rebase; installed 369 packages, audited 370 packages, 0 vulnerabilities.
- `npm run test -- tests/process.test.ts tests/request.test.ts tests/auth.test.ts tests/curation.test.ts tests/process-routes.test.ts`: passed after rebase; 5 files, 62 tests.
- `npm run typecheck`: passed after resolving the latest rebase conflicts.
- `npm run build && PATH="/root/.local/bin:$PATH" npm run test:e2e`: passed after updating the current React Flow canvas interaction selectors; isolated API smoke passed with 12 migrations and Playwright ran 15 Chromium tests, including inline node rename and drag-created designed edge persistence.
- `npm run fix`: passed on the final rebase run; checked 125 files and no fixes were applied.
- `npm run check`: passed on the final run; lint, typecheck, fixture validation, coverage with 27 files and 208 tests, guardrail probes, migration smoke, and production build all succeeded.
- Earlier `npm run check:repo` and e2e attempts exposed React Flow interaction drift after the new `WorkflowCanvas` landed on main: edge click selectors changed, label double-click competed with selection, and fit-view could place the original drag target under the walkthrough banner. Fixed by selecting visible nodes/toolbar controls, making handles unclipped, disabling node dragging so connect handles receive drag gestures, and asserting designed-edge persistence from `/api/model`.
- `PATH="/root/.local/bin:$PATH" npm run check:repo`: passed on the final run; work-item tests, all-record context check, Ruff checks, nested `npm run check` with 27 files and 208 Vitest tests, dependency audit with 0 vulnerabilities, isolated API smoke with 12 migrations, and 15 Chromium browser tests all succeeded.
- `PATH="/root/.local/bin:$PATH" python3 scripts/check_quality.py`: passed on the final explicit run; work-item tests, all-record context check, Ruff checks, nested `npm run check` with 27 files and 208 Vitest tests, dependency audit with 0 vulnerabilities, isolated API smoke with 12 migrations, and 15 Chromium browser tests all succeeded.

## Risks and rollback
- Risk: current main now includes curation controls that use `/api/model/edit` as a future persistence seam; canvas edits intentionally use `/api/model/canvas-*` so they do not change that curation fallback behavior.
- Risk: this slice persists canvas edit overlays for the current synthetic model rather than the full future `pm_*` immutable edit model described by the live #33 issue body. The new table is additive and can be retired once the foundation edit API supersedes it.
- Rollback: revert this branch, including migration `0009_graph_canvas_edits.sql`; existing event, auth, Slack and `pm_*` tables are unchanged.

## Next steps
- Open the PR with `Closes #33`, monitor CI to green, skip deployed staging verification per the time-critical user instruction, then merge only after checks are green.
