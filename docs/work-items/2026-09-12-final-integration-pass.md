# Final integration pass

Status: ready-for-review
Owner: Codex via SAM task 01M2B2RYWXWZSTPSXMMXEGY1VP for Raphael
Source: User requested a priority final integration pass after independently implemented issues #14-#44, wiring the merged frontend, backend APIs, conformance, curation, demo mode and agent runtime into one working `/app` product.
Branch: sam/priority-final-integration-pass-egy1vp
PR: https://github.com/raphaeltm/ariadneos/pull/84

## Intent
Bring the currently merged Roman-spec features together on the latest `main`: first prove or repair the repository quality baseline, then wire `/app` to real `/api/` snapshot/stream/process routes instead of fixture-only state, verify the graph, inspector, curation, conformance, settings and demo flows end to end, and deliver a PR with concrete integration evidence.

## Acceptance criteria
- Latest `main` is pulled into the task branch and `npm run check` passes after any cross-PR integration fixes.
- `/app` routes to the authenticated app shell with sidebar, workspace switching, graph canvas, inspector, curation controls, conformance overlay and settings reachable through real application routes.
- The client snapshot/SSE adapter uses live `/api/snapshot` and `/api/stream` endpoints by default, while any fixture/demo path is explicit and not the production app path.
- Graph canvas, node selection, evidence/conformance inspector detail, curation accept/reject persistence, conformance recalculation and demo simulation are verified against real Worker/D1-backed routes where the local harness supports it.
- Mastra/OpenRouter agent runtime remains callable through the agent memory `/api/ask` layer, with the configured fallback behavior preserved when live model credentials are absent.
- `npm run fix`, `npm run check`, `npm run check:repo` and `python3 scripts/check_quality.py` are run with actual outcomes recorded before handoff.

## Decisions and rationale
- Use the SAM output branch `sam/priority-final-integration-pass-egy1vp` because SAM assigned it for this integration task and it currently points at `origin/main`.
- Treat D1 and committed journal entries as the authoritative live data path, per the Cloudflare architecture contract; fixtures may remain only for tests or explicit demo helpers.
- Keep `/api/ask` wired through the existing workflow-backed agent memory route for this pass. The app maps the Helios and Atlas process workspaces to the current seeded workflows so the Mastra/OpenRouter runtime path remains callable and still falls back deterministically without live credentials.
- Implement `/api/sim/run` on top of the existing demo transcript generator, readiness gate, process persistence, conformance recalculation and graph projection instead of adding a frontend-only simulator path, so demo mode exercises the production snapshot pipeline.
- Store non-secret local/staging/production demo Slack scope defaults in `wrangler.jsonc`; without these values the live snapshot route has no configured channel scope in the local worker harness.

## Changes
- Replaced the `/app` placeholder with a live app shell that loads settings, fetches `/api/snapshot`, subscribes to `/api/stream`, renders the React Flow process graph, opens the inspector with evidence and conformance details, exposes curation accept/reject controls, shows activity evidence, switches workspaces and routes settings through the shell.
- Added a D1-backed `/api/sim/run` route that generates deterministic synthetic demo transcripts, persists sessions/messages/steps/evidence, publishes journal entries, recalculates conformance, rebuilds graph data and returns the refreshed graph/conformance payload.
- Connected demo mode in the client to the real simulator route and refreshes the live snapshot after the persisted run completes.
- Added agent chat in the app shell using the existing `/api/ask` route so the agent memory and model runtime remain callable from the process workspace.
- Added the Activity shell view and adjusted the graph fit padding so the browser smoke can reliably interact with graph nodes inside the sidebar layout.
- Added process route coverage for simulator persistence and snapshot refresh, and updated browser E2E coverage around settings, project switching, persisted demo mode, graph selection, activity evidence and sign-out session rejection.

## Validation
- `git merge --ff-only origin/main`: passed; branch was already up to date with `origin/main` at task start.
- Initial `npm run check`: failed before source checks because dependencies were not installed in the workspace: `sh: 1: biome: not found`.
- `npm ci`: passed with the committed lockfile, 0 vulnerabilities.
- Baseline `npm run check` after dependency install and before integration edits: passed on latest main.
- `npm run fix`: passed after formatting and safe mechanical fixes.
- `npm run typecheck`: passed.
- `npx vitest run tests/process-routes.test.ts tests/client-state.test.ts tests/inspector.test.ts tests/process-canvas.test.ts`: passed, 31 tests.
- `npx vitest run tests/process-routes.test.ts`: passed, 11 tests.
- `npm run check`: passed after integration changes; lint, typecheck, fixture validation, 182 coverage tests, guardrails, migration check and production build all passed.
- `npm run test:e2e`: passed after installing Playwright Chromium in the workspace; isolated API smoke and 6 Chromium browser tests passed.
- `npm run check:repo`: passed with Ruff 0.16.7 installed locally for the required Python checks; work-item context, Ruff, `npm run check`, dependency audit and browser smoke all passed.
- `python3 scripts/check_quality.py`: passed with the same locked Ruff 0.16.7 on PATH; work-item context, Ruff, `npm run check`, dependency audit and browser smoke all passed.

## Risks and rollback
- Open PRs still exist for adjacent graph editing, agent chat and dependency updates. This branch integrates the capabilities already present on `origin/main` and keeps mappings narrow where later PRs may introduce richer first-class process/agent workspace models.
- The agent chat bridge uses the current seeded workflow IDs as a compatibility layer. If a later backend adds project-native agent memory endpoints, the bridge should be replaced with that API.
- Rollback is a PR revert of this integration branch. No new database migrations were added.

## Next steps
- Wait for PR #84 CI to pass, then merge to `main` if branch protection permits.
