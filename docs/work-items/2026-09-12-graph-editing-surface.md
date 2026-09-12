# Graph editing surface

Status: in-review
Owner: Codex agent for SAM task 01M2AXMBY2A3R09R0TK6B16CWP
Source: GitHub issue #32 as directed by the user in-session: implement graph editing operations for add/remove/merge nodes and edges, editing-surface integration with the canvas, revision tracking, and undo/redo support. The issue body on GitHub appears stale/reused for an older replay task, so this record follows the user-provided scope and docs/specs/09-graph-interaction.md.
Branch: sam/implement-github-issue-32-b16cwp
PR: https://github.com/raphaeltm/ariadneos/pull/69

## Intent
Add a focused graph editing slice to the existing TypeScript/Hono Worker, D1, React, and Vite app. Edits should be recorded as an ordered session-scoped log, recompute the effective designed graph for the current workflow, expose validated API operations, and give the canvas a direct editing surface for common node and edge mutations with undo and redo.

## Acceptance criteria
- Server APIs validate graph edit actions and reject illegal node or edge mutations with 400 responses.
- Edit operations support adding, removing, merging, renaming, promoting, retiring, and requiring graph elements while preserving the base model as an edit log.
- Undo and redo reverse and reapply graph mutations as revisioned edit-log operations for the current session and workflow.
- The canvas exposes legal contextual controls and reflects returned conformance/designed graph state after each mutation.
- Required repository checks and focused regression tests have recorded outcomes before handoff.

## Decisions and rationale
- Start from current `origin/main` on the SAM output branch; no other open PR currently owns issue #32's graph editing surface.
- Use an additive D1 migration for persisted edits so session isolation follows existing authenticated user scoping.
- Keep observations immutable and compute the visible graph from events plus active edits. Undo and redo flip the `undone` flag in the edit log and recompute instead of mutating the event records.
- The GitHub issue body currently describes an older replay task, so this implementation follows the explicit user request and spec 09 graph-editing scope.

## Changes
- Added `shared/graph-edits.ts` with base designed models for the existing workflows, active edit projection, conformance recalculation, revision strings, merge rewiring, node/edge hiding, and server-side edit validation.
- Extended `shared/process.ts` with graph edit action/log metadata and optional snapshot fields for conformance, revision, edit history, and undo/redo availability.
- Added `migrations/0009_graph_edits.sql` with the session-scoped `edits` table and index.
- Updated `server/index.ts` so `/api/model`, `/api/context`, and `/api/ask` use the edited projection; added `GET /api/model/edits`, `POST /api/model/edit`, `POST /api/model/edit/undo`, and `POST /api/model/edit/redo`.
- Updated `src/process-graph.tsx`, `src/app.tsx`, and `src/style.css` with plane-aware node/edge rendering, node toolbars, inline node add/rename controls, edge creation from handles, merge-on-drag, inspector edit actions, revision display, and undo/redo buttons.
- Added `tests/graph-edits.test.ts` for promotion, add/remove node and edge, merge rewiring, rename, retire, reject, require, undo/redo flags, role-deviation recomputation, and illegal edit rejection.

## Validation
- `npm ci`: passed.
- `npm run fix`: passed after formatter/lint-driven refactors; final run reported no fixes applied.
- `npm exec -- vitest run tests/graph-edits.test.ts tests/request.test.ts tests/auth.test.ts`: passed, 26 tests before later graph-edit coverage expansion.
- `npm run check`: passed lint, typecheck, fixture validation, 165 coverage tests across 22 files, guardrail probes, migration smoke with `0009_graph_edits.sql`, and production build.
- Initial `npm run check:repo` failed because `ruff` was not installed. Installed Ruff 0.16.7 under `/tmp/ariadneos-ruff-0.16.7/ruff-x86_64-unknown-linux-gnu`.
- Second `npm run check:repo` failed because Playwright Chromium was not installed. Ran `npm exec --no -- playwright install --with-deps chromium`.
- `PATH="/tmp/ariadneos-ruff-0.16.7/ruff-x86_64-unknown-linux-gnu:$PATH" npm run check:repo`: passed work-item tests, work-item context, Ruff, full app checks, dependency audit, isolated Worker/D1/API smoke, and 6 Chromium browser tests with `0009_graph_edits.sql` after the main-branch graph KB and reusable inspector updates.
- `PATH="/tmp/ariadneos-ruff-0.16.7/ruff-x86_64-unknown-linux-gnu:$PATH" python3 scripts/check_quality.py`: passed the same full quality suite after the latest rebase, inspector conflict resolution, and migration rename.
- `python3 scripts/check_work_items.py --base origin/main`: passed after the final rebase evidence update.
- `git diff --check`: passed after the latest rebase, inspector conflict resolution, migration rename, and edge-rendering fix.
- Staging verification skipped per the user's explicit time-critical instruction.

## Risks and rollback
- Risk: Slack echo/Slack reaction undo from spec 09 is not wired in this slice because the requested owned surface is graph editing operations and the current app route uses the synthetic authenticated demo. The edit log is server-side and can support a later Slack notification hook.
- Risk: base designed models for the legacy `vendor`, `refund`, and `access` demo workflows are derived from their main synthetic path so the editing surface can work on current `/app`; later KB-backed workflow loading can replace that adapter without changing the edit-log contract.
- Rollback: revert the migration, server edit module/routes, client API wiring, canvas controls, tests, and this work item before remote migration. After remote D1 migration, leave the additive table unused or apply a cleanup migration.

## Next steps
- Monitor PR #69 CI and merge only when required checks are green. Staging verification is intentionally skipped for this task per user instruction.

## Post-rebase update
- Rebased onto current `origin/main` after main advanced with graph KB persistence, agent memory, and reusable inspector work. Renamed this task's migration from `0007_graph_edits.sql` to `0009_graph_edits.sql` so the migration order remains unique after the main-branch graph KB and agent-memory migrations.
- Refactored `src/app.tsx` shell helpers and simulation runner after the rebase to stay within the repository cognitive-complexity gate. Wired graph edit buttons through the new reusable `ProcessInspector` action slot instead of restoring duplicated inspector markup.
- Re-ran the required quality commands after the rebase and migration rename before pushing the PR branch.

## Second post-rebase update
- Rebased onto a newer `origin/main` that added `0008_agent_memory.sql`; renamed this task's migration again from `0008_graph_edits.sql` to `0009_graph_edits.sql`.
- Resolved the app and graph conflicts by composing persisted graph edits with the newer optimistic curation controls and reusable inspector action slot.
- Kept edge labels visible and sorted rendered graph edges by layout rank so the existing browser edge-click regression continues to exercise a visible edge after the canvas integration.
