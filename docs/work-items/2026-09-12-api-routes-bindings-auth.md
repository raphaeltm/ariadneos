# API Routes Bindings And Auth

Status: in-review
Owner: Codex via SAM task 01M2AWQMS35X4SSNBS3V2C8P58 for Raphael
Source: GitHub issue #22 requests authenticated Hono route mounting for process snapshots, journal SSE streams, KB CRUD/read paths, curation actions, graph views, D1/DO bindings, and route-level validation/error handling.
Branch: sam/implement-github-issue-22-2c8p58

## Intent
Connect the merged process-mining foundations into the Worker route layer without replacing their internals. The route layer should require Better Auth, enforce configured workspace/channel scope, validate query/path/body inputs, return structured errors, expose graph snapshot/read APIs and SSE replay, and keep existing health, auth, Slack and demo behavior compatible.

## Acceptance criteria
- Authenticated process API routes are mounted for KB, snapshot, designed/discovered/overlay graph views, sessions, messages, step evidence, step curation status, graph rebuild and journal streams.
- Routes use the existing D1 binding and channel coordinator Durable Object binding where appropriate, and reject unauthenticated or foreign scope requests before exposing channel evidence.
- Query strings, route params and JSON bodies are validated with bounded limits and errors shaped as `{error: {code, message}}`.
- Route tests cover auth failures, invalid inputs, scoped success responses and SSE cursor handling.
- Required local checks run: `npm run fix`, `npm run check`, `npm run check:repo`, `python3 scripts/check_quality.py` and the work-item context check.

## Decisions and rationale
- Start from current `origin/main` at `e1ffff0`, where #16, #19, #20, #21, #31 and KB helpers are merged; #18 persistence remains unmerged, so this route layer will use the D1 tables/helpers available on main and record any integration gap explicitly.
- Keep changes scoped to server route composition and endpoint handlers. Do not edit Wrangler bindings owned by #16 unless tests reveal an actual binding gap.
- Mount the process route module after the existing legacy demo/model/ask routes so their smoke-tested behavior remains unchanged while new process endpoints own `/api/snapshot`, `/api/stream` and related process paths.
- Use the bundled authored KB for read responses because the merged D1 foundation schema has concrete `pm_*` tables, while the helper `pm_kb_*` persistence contract from #15 has no migration on current main. Live sessions, messages, steps, evidence, curation and journal cursors are read from D1.

## Changes
- Added `server/routes/process.ts` with authenticated route handlers for `/api/kb`, `/api/snapshot`, graph views, sessions, messages, step evidence, step status curation, graph rebuild, SSE stream forwarding and pause/resume coordinator controls.
- Replaced the old thin `/api/snapshot` and `/api/stream` coordinator proxies in `server/index.ts` with the mounted process route layer while preserving health, auth, Slack, legacy simulation, model, context and ask routes.
- Added D1 read adapters for scoped `pm_session`, `pm_message`, `pm_step`, `pm_step_evidence` and `pm_journal`, plus graph/conformance adapters over the merged pure mining modules.
- Added `tests/process-routes.test.ts` covering unauthenticated rejection, foreign scope rejection, D1-backed snapshot success, pagination validation, curation status journal writes and SSE cursor/scope forwarding to a Durable Object stub.
- PR: https://github.com/raphaeltm/ariadneos/pull/64.

## Validation
- `npm ci` passed and installed locked dependencies.
- `npm exec -- vitest run tests/process-routes.test.ts` passed: 6 tests.
- `npm run fix` initially reported style diagnostics in the new route module; after manual cleanup, rerun passed with no fixes applied.
- `npm run check` passed: Biome/Ultracite lint, strict TypeScript, fixture validation, 119 coverage tests, guardrail probes, PM migration smoke and production build.
- First `npm run check:repo` failed because the container lacked `ruff`; installed Ruff 0.16.7 locally for validation.
- Second `npm run check:repo` failed only because Playwright Chromium was missing; ran `npm exec --no -- playwright install --with-deps chromium`.
- Final `PATH="/workspaces/ariadneos/.local-tools/ruff-0.16.7:$PATH" npm run check:repo` passed: work-item tests, Ruff, full app check, dependency audit, isolated Worker/D1/API smoke and 5 Chromium browser tests. The temporary `.local-tools` directory was removed afterward.
- `PATH="/workspaces/ariadneos/.local-tools/ruff-0.16.7:$PATH" python3 scripts/check_quality.py` passed before removing the temporary Ruff install; same suite as `check:repo`, including browser smoke.
- `python3 scripts/check_work_items.py --base origin/main` passed.

## Risks and rollback
- Risk: issue #18 persistence is still unmerged, so `/api/sim/run` is mounted but returns a structured 503 instead of starting a durable run. Rebase when #18 lands and replace this placeholder with its persistence/run helper.
- Risk: authored KB mutation endpoints are not implemented because the current merged schema does not include the `pm_kb_*` helper tables from #15. The read path returns the bundled authored KB and live process state from D1.
- Rollback is a code revert; no schema or Wrangler binding changes are included in this route-layer PR.

## Next steps
- Monitor PR #64 CI, skip staging verification per user instruction for this time-critical task, and merge only when required checks are green.
