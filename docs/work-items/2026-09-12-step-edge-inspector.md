# Step and edge inspector

Status: in-review
Owner: Codex agent for SAM task 01M2AXAVBN6G701NTR0VS9V1N6
Source: GitHub issue #26 / SAM task "Build step/edge inspector with evidence, curation and conformance detail"
Branch: sam/implement-github-issue-26-s9v1n6

## Intent
Add an inspector panel for selected process steps and edges that explains what was selected, shows evidence with source provenance, exposes curation actions for observations, and summarizes conformance findings. Keep the work focused on the inspector UI surface while integrating with the current canvas selection path and the typed client contracts from issue #23 where they are available.

## Acceptance criteria
- Selecting a step or edge shows details for that item, including plane, support/count, cases, actors, grounding, and policy/conformance context.
- Evidence entries show quoted source text, author/time, case, and provenance links when a permalink exists.
- Proposed observations have confirm/reject/flag controls with clear pending/error states; rejected or already confirmed observations do not pretend to be editable.
- Conformance detail shows fitness/precision/grounding, missing/extra activities, order breaks, role deviations, and policy violations tied to the selected step or edge when available.
- Repository quality commands and context checks are recorded before handoff; staging verification is skipped per the time-critical task instruction.

## Decisions and rationale
- Start from current `origin/main` at `e1ffff0` on the SAM output branch because the required dependencies are already merged into main for this task.
- Build the inspector as a reusable frontend subtree rather than folding more logic into `src/app.tsx`, so future #23/#24 shell work can consume the same data preparation and curation surface.

## Changes
- Added `src/components/inspector/inspector-data.ts` to derive inspector view models from both typed snapshot/client-state records and the current legacy `/api/model` graph shape. It resolves node, edge, and message selections to evidence quotes, curation items, grounding metrics, and conformance sections.
- Added `src/components/inspector/process-inspector.tsx` with evidence provenance links, curation controls for proposed observations, flag controls, conformance sections, selected item metrics, and source-event navigation.
- Wired the existing `/app` inspector panel through the new component while preserving the canvas edge/node selection behavior and existing "Inspect source events" browser workflow.
- Added `tests/inspector.test.ts` covering typed fixture node evidence/curation, edge policy violation detail, and legacy app selection compatibility.
- Added inspector CSS for badges, evidence cards, curation controls, and conformance breakdowns.

## Validation
- `npm ci`: passed; installed locked dependencies with 0 vulnerabilities.
- `npm run fix`: initially reported two style issues after formatting; passed after replacing a nested ternary and moving the test regex to module scope. Final reruns passed with no fixes applied.
- `npm run test -- tests/inspector.test.ts`: passed, 3 tests.
- `npm run typecheck`: passed.
- `npm run check`: passed lint, typecheck, fixture validation, 116 coverage tests, guardrail probes, migration check, and production build.
- `npm run test:e2e`: initially failed because Playwright Chromium was not installed; after `npm exec --no -- playwright install --with-deps chromium`, it failed once because the served build still had the previous inspector button placement. After rebuilding, passed API smoke and 5 Chromium browser tests.
- `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: initially failed because Ruff was not installed, then because Playwright Chromium was missing, then once on the source-events action in the old bundle. Final rerun passed work-item tests, Ruff 0.16.7 checks, `npm run check`, dependency audit, isolated Worker/D1/API smoke, and 5 Chromium browser tests.
- `PATH="/tmp/ariadneos-ruff:$PATH" python3 scripts/check_quality.py`: passed the same full repository quality suite and 5 Chromium browser tests.
- Staging verification skipped per the user's time-critical instruction.

## Risks and rollback
- The current `/app` route still consumes the legacy `/api/model` shape, while typed snapshot/SSE contracts also exist for the forthcoming app shell. The inspector will avoid taking over backend ownership and will degrade curation controls when no step-status endpoint is present.
- The visible `/app` curation controls only become actionable for proposed typed step records with a mounted step-status endpoint; legacy synthetic observations show confirmed/flaggable context without mutating backend state.
- Roll back by reverting the inspector component subtree, its app wiring, tests, and this work item.

## Next steps
- Open the PR with `Closes #26`, monitor CI, and merge only when green. Do not perform staging verification for this task.
