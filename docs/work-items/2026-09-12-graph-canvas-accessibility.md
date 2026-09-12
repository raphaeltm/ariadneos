# Graph canvas keyboard accessibility

Status: in-review
Owner: Codex agent for SAM task 01M2AZF0JPTRTBT1TMRVSXMXE9
Source: User request to implement GitHub issue #43 as "Add keyboard shortcuts and accessibility for graph canvas interactions." GitHub issue #43 currently has a broader presenter-mode title/body; this work follows the concrete task text supplied in the session and keeps the PR closing link as requested.
Branch: sam/implement-github-issue-43-sxmxe9
PR: https://github.com/raphaeltm/ariadneos/pull/79

## Intent
Add keyboard shortcuts, focus management, ARIA labels, and screen-reader status for graph canvas interactions. Cover the typed workflow canvas introduced by issue #24 and keep the current app shell graph experience usable while the app still renders the legacy process graph.

## Acceptance criteria
- Keyboard users can focus the graph canvas, move selection through visible nodes and edges, delete/clear selection, undo/restore selection, zoom, pan, and fit view without entering pointer mode.
- Canvas regions, nodes, edges, controls, legends, and status updates expose meaningful labels or roles for assistive technology.
- Shortcuts do not steal text input focus from form fields or content-editable targets.
- Focus and screen-reader feedback survive mode/support changes and empty graph states without errors.
- Repository checks and focused behavior tests run locally; staging verification is skipped per the time-critical user instruction.

## Decisions and rationale
- Keep the keyboard model scoped to focused graph canvases so shortcuts do not fire while users type in search, ask, settings, select, or editable controls.
- Add pure shortcut and keyboard-target helpers in the process-canvas module so key mapping, text-input exclusion, and selection order are covered by fast regression tests.
- Treat the current graph as a read-only canvas: Delete/Backspace clears the selected graph item and Ctrl/Cmd+Z restores the previous selection, rather than adding destructive graph-editing behavior outside this issue's merged app surface.
- Wire both the issue #24 `WorkflowCanvas` component and the currently rendered legacy `ProcessGraph`, because `/app` still uses the legacy graph while the typed canvas subtree is available for downstream integration.

## Changes
- Added reusable canvas shortcut instructions, shortcut resolution, keyboard target ordering, and edge lookup helpers in `src/components/process-canvas/graph.ts`.
- Added ARIA labels for typed canvas node and edge data in `src/components/process-canvas/types.ts` and `graph.ts`.
- Updated `WorkflowCanvas` with focusable React Flow application semantics, `aria-activedescendant`, screen-reader-only shortcut help, live status announcements, keyboard selection, clear selection, undo selection, zoom, pan, fit-view behavior, pointer-selection announcements, and focus styling.
- Updated the current `/app` `ProcessGraph` with matching focus semantics, live announcements, keyboard selection/clear/undo/zoom/pan/fit-view behavior, and ARIA labels on visual activity nodes.
- Added regression coverage for shortcut resolution, text-entry exclusion, and keyboard target ordering in `tests/process-canvas.test.ts`.
- Added browser coverage for keyboard selection, Delete clearing, and Ctrl/Cmd+Z restore on the shipped `/app` process canvas.

## Validation
- `npm ci`: passed after the latest rebase, installed locked dependencies and audited 370 packages with 0 vulnerabilities.
- `npm run fix`: first run surfaced complexity, promise-handling, and accessibility diagnostics; passed after refactoring and ARIA cleanup; passed again after rebases onto updated `origin/main`.
- `npm run test -- tests/process-canvas.test.ts`: passed after the latest rebase, 12 tests.
- `npm run typecheck`: initially failed on optional React Flow edge data and a too-narrow legacy node-label helper; passed after fixes and after the latest dependency install.
- `npm run check`: passed after the latest rebase onto `origin/main` (`8e91064`): lint, typecheck, fixture validation, 183 coverage tests, guardrail probes, PM migration smoke, and production build.
- Initial `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: failed at browser tests because Playwright Chromium was not installed locally; no app assertions ran.
- `npm exec --no -- playwright install --with-deps chromium`: passed and installed Chromium plus required system dependencies.
- Final `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed after the latest rebase: work-item tests, all-record context validation, Ruff checks, `npm run check`, dependency audit, isolated Worker/D1/API smoke, and 7 Chromium browser tests.
- Initial `python3 scripts/check_work_items.py --base origin/main`: failed because the new work-item file was not staged yet.
- After staging the work item, `python3 scripts/check_work_items.py --base origin/main`: passed.

## Risks and rollback
- The current `/app` graph is still the legacy `ProcessGraph`; the issue #24 `WorkflowCanvas` receives the same support for downstream integration, but this PR does not replace the app's graph data path. Rollback is a straight revert of the touched canvas modules, CSS, tests, and this work item.
- Staging verification is intentionally skipped per the time-critical user instruction.

## Next steps
- Monitor PR #79 CI and merge when green per the user's delivery instruction. Staging verification remains intentionally skipped.
