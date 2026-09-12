# Final integration pass

Status: in-review
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
- Replaced the `/app` placeholder with a live app shell that loads settings, fetches `/api/snapshot`, subscribes to `/api/stream`, renders the React Flow process graph, opens the inspector with evidence and conformance details, exposes curation accept/reject controls, shows activity evidence, switches workspaces and routes settings through the shell. After merging newer main heads, kept the live API path integrated with the guided walkthrough, how-it-works entry point, canvas accessibility updates, graph editing surface, inspector refinements and agent chat panel from the other completed tasks.
- Added a D1-backed `/api/sim/run` route that generates deterministic synthetic demo transcripts, persists sessions/messages/steps/evidence, publishes journal entries, recalculates conformance, rebuilds graph data and returns the refreshed graph/conformance payload.
- Connected demo mode in the client to the real simulator route and refreshes the live snapshot after the persisted run completes.
- Added the dedicated Agent chat shell view using the existing `/api/ask` route so the agent memory and model runtime remain callable from the live process workspace. The client maps Roman workflow IDs such as `wf_p1_incident` to the current legacy agent-memory workflow ids accepted by `/api/ask`.
- Added the Activity shell view, retained the graph editing toolbar against the live `/api/model/edit` route, and adjusted the graph/browser checks for the merged canvas accessible name and sidebar layout. Activity now defaults to all sessions unless a case is explicitly selected, so evidence jumps do not land on an empty newest-session filter.
- Added process route coverage for simulator persistence and snapshot refresh, and updated browser E2E coverage around settings, project switching, persisted demo mode, graph selection, activity evidence, agent chat streaming and sign-out session rejection.

## Validation
- `git merge --ff-only origin/main`: passed; branch was already up to date with `origin/main` at task start.
- Initial `npm run check`: failed before source checks because dependencies were not installed in the workspace: `sh: 1: biome: not found`.
- `npm ci`: passed with the committed lockfile, 0 vulnerabilities.
- Baseline `npm run check` after dependency install and before integration edits: passed on latest main.
- `npm run fix`: passed after formatting and safe mechanical fixes.
- `npm run typecheck`: passed.
- `npx vitest run tests/process-routes.test.ts tests/client-state.test.ts tests/inspector.test.ts tests/process-canvas.test.ts`: passed, 31 tests.
- `npx vitest run tests/process-routes.test.ts`: passed, 11 tests.
- Merged `origin/main` after PR #84 reported conflicts; resolved the first conflict set by keeping the live `/api/` application shell and integrating the guided walkthrough, how-it-works route, canvas accessibility and inspector updates from main.
- Merged the next `origin/main` head `ded9915` after agent chat and graph editing landed; resolved conflicts by preserving the D1-backed snapshot/SSE app, adding the dedicated Agent chat shell view, mapping live process workflow IDs to the `/api/ask` compatibility workflows, retaining graph edit controls against `/api/model/edit`, and keeping Activity as a first-class shell view.
- `npm run fix`: passed on the final merge resolution.
- `npm run typecheck`: passed on the final merge resolution.
- `npm run build`: passed before E2E reruns so the Worker served the current client bundle.
- `npm run check`: passed on the final source; lint, typecheck, fixture validation, 200 coverage tests across 27 files, guardrails, migration check and production build all passed.
- `npm run test:e2e`: passed on the final source; isolated API smoke and 14 Chromium browser tests passed, including `/app` settings, persisted demo mode, activity evidence, guided walkthrough, project switching, canvas keyboard selection, agent chat streaming and sign-out rejection.
- `npm run check:repo`: passed with Ruff 0.16.7 installed locally for the required Python checks; work-item context, Ruff, nested `npm run check`, dependency audit, API smoke and 14 browser tests all passed.
- `python3 scripts/check_quality.py`: passed with the same locked Ruff 0.16.7 on PATH; work-item context, Ruff, nested `npm run check`, dependency audit, API smoke and 14 browser tests all passed.

## Risks and rollback
- Graph editing and agent chat landed on `origin/main` while this PR was open and are now integrated into the live app shell. The graph edit payload bridge is intentionally narrow and translates canvas ids to workflow slugs for the current `/api/model/edit` route.
- The agent chat bridge uses the current seeded legacy workflow IDs as a compatibility layer for `/api/ask`. If a later backend adds project-native agent memory endpoints, the bridge should be replaced with that API.
- Rollback is a PR revert of this integration branch. The only new migration in the final branch is the graph-edits migration already merged from `origin/main`.

## Next steps
- Push the final merge-resolution commit, wait for PR #84 mergeability/CI to refresh, then merge to `main` if branch protection permits.
