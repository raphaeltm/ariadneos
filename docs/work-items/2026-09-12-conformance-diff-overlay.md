# Conformance diff overlay and canvas annotations

Status: in-review
Owner: Codex agent for SAM task 01M2AZ5QK53Q7EPGBMZG8WGZS0
Source: User request and SAM task for GitHub issue #35, "Add conformance diff overlay and violation annotations to graph canvas." Build the conformance diff overlay and severity annotations on the existing workflow canvas. GitHub issue #35 currently has a mismatched title, so this record follows the task title and prompt.
Branch: sam/implement-github-issue-35-8wgzs0

## Intent
Make conformance differences visible directly on the workflow canvas by classifying designed-only, discovered-only, deviant transition, violation, and role-deviation states, annotating nodes and edges with severity indicators, and connecting the conformance strip to canvas selection.

## Acceptance criteria
- Overlay mode visually distinguishes missing documented work, extra discovered work, deviant transitions, policy violations, and role deviations.
- Nodes and edges expose severity metadata for conformance annotations without changing backend contracts.
- Conformance strip controls select representative missing, extra, violation, and role-deviation items on the canvas.
- Regression tests cover diff classification, severity selection, and visible graph filtering behavior.
- Required repository checks run locally; staging verification is skipped per the user’s time-critical instruction.

## Decisions and rationale
- Keep the implementation inside `src/components/process-canvas/`, reusing the existing `GraphView` contract and fixture data from merged canvas/conformance work instead of adding API or persistence changes.
- Compute annotation state in pure helpers so tests can verify semantics independently of React Flow rendering.

## Changes
- Added conformance overlay summary and selection helpers in `src/components/process-canvas/graph.ts`.
- Canvas node and edge data now carries diff kind, severity, annotation label, and annotation title derived from the existing `GraphView` and `WorkflowConformance` data.
- The workflow canvas conformance strip now shows clickable missing, extra, violation, and role-deviation counts, plus a deviant-path count.
- Nodes render severity rings and diff pills for missing, extra, policy, and role-deviation states; violating/deviant edges use severity color and visible labels.
- Added regression coverage for summary counts, node and edge classification, and representative issue selection.
- Opened PR #73: https://github.com/raphaeltm/ariadneos/pull/73.

## Validation
- `npm ci`: passed and installed locked dependencies.
- `npm run test -- tests/process-canvas.test.ts`: passed, 10 tests.
- `npm run typecheck`: passed.
- `npm run fix`: passed; Ultracite formatted two changed files.
- `npm run check`: passed lint, typecheck, fixture validation, coverage with 16 files and 136 tests, guardrail probes, migration smoke, and production build.
- Initial `npm run check:repo`: failed because `ruff` was not installed.
- Installed Ruff 0.16.7 to `/tmp/ariadneos-ruff`; reran `PATH=/tmp/ariadneos-ruff:$PATH npm run check:repo`.
- Second `npm run check:repo`: failed only because Playwright Chromium was not installed after API/e2e smoke passed.
- `npm exec --no -- playwright install --with-deps chromium`: passed and installed Chromium plus required system dependencies.
- Final `PATH=/tmp/ariadneos-ruff:$PATH npm run check:repo`: passed Python work-item tests, work item validation, Ruff checks, full app checks, dependency audit, local Worker/D1/API smoke, and 6 Chromium browser tests.
- `PATH=/tmp/ariadneos-ruff:$PATH python3 scripts/check_quality.py`: passed the same full quality suite and browser checks.
- `python3 scripts/check_work_items.py --base origin/main`: failed before staging because the new work item was untracked; passed after staging the intended files.
- Staging verification skipped per the user’s time-critical instruction.

## Risks and rollback
- GitHub issue #35 currently has a title/body mismatch with the SAM task. The implementation follows the SAM task and user prompt; PR text should call this out. Rollback is removing the canvas helper/UI changes, tests, and this work item.

## Next steps
- Monitor PR #73 CI and merge when green. Staging verification remains skipped per instruction.
