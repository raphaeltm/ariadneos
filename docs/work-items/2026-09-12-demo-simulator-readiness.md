# Demo simulator readiness gate

Status: in-review
Owner: Codex agent for issue #28, SAM task 01M2AXM2ZDS1260JZZJ63M66GE
Source: GitHub issue #28 and user request to implement an end-to-end demo simulator, synthetic Helios/Atlas transcript generator, readiness gate, and integration harness against current main while skipping staging verification for speed.
Branch: sam/implement-github-issue-28-3m66ge

## Intent
Provide a focused demo simulator and readiness gate that exercise the current Slack-shaped process-mining pipeline from realistic unstructured observations through extraction, deterministic graph mining, conformance scoring, and UI-consumable snapshot data. Keep the work scoped to simulator, readiness, transcript generation, and integration harness modules, preserving the existing TypeScript/Hono Worker, D1, React/Vite, Better Auth, Slack-only scope, and current demo routes.

## Acceptance criteria
- Deterministic Helios and Atlas transcript generation produces Slack-like messages with persona identity, agendas, delays, scenario variants, and expected deviations while rejecting self-labelled domain fields.
- The readiness gate validates observations to extraction to mining to conformance to UI snapshot data and reports pass/fail evidence for each stage.
- Integration tests cover successful Helios/Atlas runs plus negative readiness cases for invalid transcripts, missing expected deviations, and UI-incomplete output.
- Repository checks requested by the task are run and their actual results are recorded here.

## Decisions and rationale
- Use local TypeScript modules and fixtures instead of new services so the gate stays fast, deterministic, and compatible with the existing Cloudflare Worker architecture.
- Keep synthetic transcript ground truth separate from extracted observations; the gate may compare expected deviations for readiness but must not treat synthetic transcript metadata as mined evidence.

## Changes
- Added `server/demo/simulator.ts` with Helios and Atlas scenario definitions, persona agendas, deterministic transcript generation, transcript validation, and conversion to Slack-like normalized observations.
- Added `server/demo/readiness.ts` with a readiness gate that runs observations through the existing extraction and canonicalization modules, mines an aggregate graph, scores conformance, and emits a UI-consumable snapshot.
- Added `scripts/generate-demo-transcripts.ts`, `scripts/check-demo-readiness.ts`, and npm scripts `sim:generate` and `sim:readiness`.
- Added five cached text-only transcript fixtures under `fixtures/transcripts/`.
- Added `tests/demo-readiness.test.ts` covering deterministic generation, transcript-field validation, observation rendering, full readiness success, missing expected deviations, and incomplete UI evidence.

## Validation
- `npm ci`: passed; 232 packages installed and 0 vulnerabilities reported.
- `npm run sim:generate`: passed; wrote 5 demo transcripts to `fixtures/transcripts`.
- `npm run sim:readiness -- --fixtures=fixtures/transcripts`: passed; 5 sessions, 40 messages, 42 extracted steps, 41 canonical steps, 23 graph nodes, 34 graph edges, 7 grounded conformance violations, no missing UI evidence.
- `npm run test -- tests/demo-readiness.test.ts`: passed; 6 tests.
- `npm run typecheck`: passed.
- `npm run fix`: passed after hand-fixing reported diagnostics; final run checked 88 files and applied no failing changes.
- `npm run check`: passed; lint, typecheck, fixture validation, 122 coverage tests, guardrail probes, migration smoke, and production build.
- `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed after installing Ruff 0.16.7 plus Playwright Chromium and OS browser dependencies; includes Python work-item tests, Ruff, app checks, dependency audit, isolated Worker/D1 smoke, and 5 Chromium browser tests.
- `PATH="/tmp/ariadneos-ruff:$PATH" python3 scripts/check_quality.py`: passed; same full quality suite and browser checks.
- `git diff --check`: passed.
- `python3 scripts/check_work_items.py --base origin/main`: first attempt failed because the new work item was not yet staged; rerun after staging passed.

## Risks and rollback
- Live Slack staging verification is intentionally skipped per the user's time-critical instruction, so this PR can prove the local end-to-end simulator/readiness path but not live Slack delivery.
- The deterministic readiness extractor is a harness adapter for repeatable validation; it does not claim live model extraction quality or live Slack posting success.
- Rollback is to revert the simulator/readiness modules, tests, scripts, and this work item.

## Next steps
- Open the PR with `Closes #28`, monitor CI, and merge once required checks are green. Staging verification is skipped per the time-critical user instruction.
