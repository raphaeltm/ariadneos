# Inline graph curation UI

Status: in-review
Owner: Codex agent for SAM task 01M2AXB10XHQYM69SF5XRS2KXN
Source: User request to implement inline graph curation controls with optimistic undo for GitHub issue #27, using the curation UI component subtree while API persistence remains owned by the separate model-edit backend work.
Branch: sam/implement-github-issue-27-rs2kxn

## Intent
Add contextual curation controls directly on graph nodes and edges so a process owner can confirm, reject, merge, or split discovered observations from the canvas. Keep the implementation additive to the current React/Vite app and integrate with the typed client/API boundary for the future authoritative model-edit endpoints.

## Acceptance criteria
- Selecting a graph node or edge shows inline curation controls for confirm, reject, merge, and split actions without cluttering the resting canvas.
- Curation actions apply optimistically to the graph view, surface pending/saved/local/failure state, and can be undone from the UI or keyboard.
- Confirm/reject/merge/split calls use bounded typed payloads for the curation API integration while keeping the current demo usable if the backend edit route is unavailable on main.
- Focused regression tests cover legal action derivation, optimistic graph projection, undo, and API fallback behavior.
- `npm run fix`, `npm run check`, `npm run check:repo`, `python3 scripts/check_quality.py`, and `python3 scripts/check_work_items.py --base origin/main` have recorded outcomes before handoff.

## Decisions and rationale
- Keep this work in frontend curation modules plus narrow API adapter additions because issue #33 owns persistence, schema, server validation, Slack echo, and authoritative effective-model reduction.
- Use a local optimistic edit stack over the existing `/api/model` demo graph so the UI can be reviewed now and later consume `/api/model/edit` without replacing the app shell.
- Treat a missing `/api/model/edit` or `/api/model/edit/undo` route as a local-only saved state for this UI PR, with visible status and undo, because current main does not include the authoritative model-edit backend yet.

## Changes
- Added `src/curation.ts` with legal-action derivation, optimistic graph projection for confirm/reject/merge/split, undo state, curation summaries, and typed persistence calls for `/api/model/edit` and `/api/model/edit/undo`.
- Updated `src/process-graph.tsx` so selected nodes and edges show inline icon curation controls with pending badges, edge labels, and API action callbacks.
- Updated `src/app.tsx` to manage the optimistic curation stack, keyboard shortcuts for C/X/M/S and Cmd/Ctrl+Z, local-only fallback notices, and a curation status strip.
- Updated `src/style.css` with compact graph toolbar, edge-control, curation badge, and undo/status styling.
- Added `tests/curation.test.ts` covering legal actions, reject/undo, merge, split, and missing-route API fallback.

## Validation
- `npm ci`: passed, installed locked dependencies and found 0 vulnerabilities.
- `npm exec -- vitest run tests/curation.test.ts`: passed, 5 tests.
- `npm run typecheck`: passed after extracting curation and loaded-workspace helpers from `App` during the rebase onto the newer app shell.
- `npm run fix`: passed after refactoring complexity/style diagnostics; final run reported no fixes applied.
- `npm run check`: passed after the second rebase onto `origin/main`, including lint, typecheck, fixture validation, 140 coverage tests, guardrail probes, migration check, and production build.
- `npm run check:repo`: first local attempt could not find `ruff`; installed the locked Ruff 0.16.7 binary under `/tmp/ariadneos-tools` and reran. A later attempt failed because Playwright Chromium was missing; installed Chromium with `npm exec --no -- playwright install --with-deps chromium`. A browser check then exposed edge curation labels intercepting existing edge clicks, so `src/style.css` now keeps the label wrapper non-interactive and enables pointer events only on the toolbar. Final post-second-rebase run with `PATH=/tmp/ariadneos-tools/ruff-x86_64-unknown-linux-gnu:$PATH` passed all repository gates, dependency audit, API smoke, and six browser tests.
- `python3 scripts/check_quality.py`: passed after the second rebase with the locked Ruff path, including Python unit checks, work-item history validation, Ruff, npm checks, dependency audit, API smoke, and six browser tests.

## Risks and rollback
- The authoritative edit API is not present on current main, so persistence can only be verified through typed client calls and fallback behavior in this PR.
- Roll back by reverting this PR; planned changes are additive frontend modules, tests, and this work item.

## Next steps
- Run `python3 scripts/check_work_items.py --base origin/main` after staging the final intended files.
- Open the PR with `Closes #27`, monitor CI, skip staging verification per the time-critical user instruction, and merge when green.
