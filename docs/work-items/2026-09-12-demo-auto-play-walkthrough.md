# Demo auto-play walkthrough

Status: in-review
Owner: Codex agent for issue #42, SAM task 01M2AZETT0XPJ397SJC7XZ6MHK
Source: User request and SAM task to implement demo auto-play mode with guided walkthrough annotations, integrating the issue #28 demo simulator readiness work and issue #24 workflow canvas. GitHub issue #42 was observed on 2026-09-12 to currently describe persona filtering instead of this auto-play scope; this work item follows the user/SAM task scope.
Branch: sam/implement-github-issue-42-xz6mhk

## Intent
Add a presenter-friendly demo auto-play mode that steps through the simulated AriadneOS workflow, advances visible demo state over time, and highlights the overview, simulator run, conversation, workflow graph, evidence inspector, and variant planning beats with concise guided annotations. Keep the implementation in the existing Vite/React app and deterministic local simulator path, without adding a parallel backend or staging verification.

## Acceptance criteria
- The app exposes a demo auto-play control that can start, pause, resume, restart, stop, and jump between guided walkthrough beats without unmounting the canvas or losing the last good graph.
- Walkthrough annotations identify the active beat, explain what is being highlighted, and visually target the relevant overview, run, conversation, graph, inspector, or variants area.
- Auto-play reuses the current `/api/simulate` demo path and issue #24 canvas state so the walkthrough shows real simulated workflow data rather than a disconnected mock.
- Keyboard shortcuts for demo playback and beat navigation work without breaking text entry or graph selection.
- Repository checks requested by the task are run and their actual results are recorded here.

## Decisions and rationale
- Build the walkthrough as client-side demo orchestration around the existing app route because the current simulator is exposed through `/api/simulate`, and the requested work is a presenter workflow rather than a new persistence contract.
- Use deterministic beat metadata in a shared module instead of a new service endpoint so the demo remains fast, local, and compatible with the current Cloudflare Worker architecture.
- Adapt the legacy `ProcessModel` used by `/app` into the merged issue #24 `WorkflowCanvas` contract inside a narrow bridge. This keeps existing selectors, inspector state, and simulator persistence intact while letting the demo target the shared canvas component.
- Disable pointer capture on canvas edge labels so clicking an evidence edge still selects the underlying edge after the #24 canvas integration.

## Changes
- Added a six-step demo walkthrough model with deterministic labels, target metadata, and navigation helpers.
- Added demo controls to `/app` for start, pause, resume, restart, stop, next/previous beat, and direct beat jumps. Space toggles playback, arrow keys step beats, and number keys jump to a beat when focus is not in editable content.
- Added guided annotations and visual focus rings for the overview, simulator run, conversation, workflow graph, evidence inspector, and variants planning areas.
- Wired the simulate beat to the existing `/api/simulate` path so auto-play produces persisted demo cases and then advances through the resulting events, graph, evidence, and variants.
- Rendered the issue #24 `WorkflowCanvas` in the app via a legacy-to-contract adapter while preserving the existing inspector selection flow.
- Added focused unit coverage for walkthrough navigation and legacy canvas adaptation, plus browser coverage for auto-play, beat jumps, evidence highlighting, variants highlighting, and pause/resume keyboard behavior.

## Validation
- `npm ci`: passed on current main dependencies, added 369 packages, 0 vulnerabilities.
- `npm run fix`: passed after applying safe formatter/linter fixes and inspecting the diff.
- `npm run test -- tests/demo-walkthrough.test.ts tests/legacy-canvas-bridge.test.ts`: passed, 2 files and 5 tests.
- `npm run typecheck`: passed.
- `npm run check`: passed after rebasing on current main, including lint, typecheck, fixture validation, 26 unit/integration test files with 186 tests, guardrails, migration check, and production build.
- `PATH="/tmp/ariadneos-ruff:$PATH" npm run test:e2e`: passed API smoke plus 7 Playwright browser tests.
- `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed, including script tests, work-item context check, Ruff 0.16.7 check/format, repository checks, API smoke, and 7 browser tests.
- Staging verification was intentionally skipped per the time-critical user instruction.

## Risks and rollback
- GitHub issue #42 currently appears to track a different scoped deliverable; reviewers should reconcile the tracker before relying on `Closes #42` as issue evidence.
- The legacy canvas adapter is intentionally narrow and should be removed once `/app` consumes the typed snapshot graph contract directly.
- Staging verification is skipped per the time-critical user instruction.
- Rollback is to revert the walkthrough UI/state changes, canvas bridge, focused tests, CSS adjustments, and this work item.

## Next steps
- Open the PR with `Closes #42`, monitor CI until green, then merge the branch if CI passes.
