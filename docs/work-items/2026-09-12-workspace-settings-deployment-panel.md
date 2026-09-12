# Workspace settings and deployment panel

Status: in-review
Owner: Codex via SAM task 01M2AZF59VFX3GM6669W3E1GJB for Raphael
Source: User requested implementation of GitHub issue #44 as "Add workspace settings UI and deployment configuration panel", starting from current main, integrating the merged app shell from #25 and API routes from #22, skipping staging verification for speed, and opening a PR with `Closes #44`.
Branch: sam/implement-github-issue-44-3e1gjb
PR: https://github.com/raphaeltm/ariadneos/pull/78

## Intent
Add a workspace settings surface inside the existing `/app` shell that shows configuration status and deployment controls using the current TypeScript/Cloudflare app architecture. Keep the change focused on configuration management and deployment visibility without replacing the graph canvas, auth, Slack integration, or process API contracts.

## Acceptance criteria
- The app shell exposes a workspace settings panel with configuration management details for the selected workspace/project.
- The settings view displays deployment configuration and provides controls appropriate for the current API surface.
- The implementation composes with the merged #25 app shell and #22 authenticated API routes.
- Required checks run: `npm run fix`, `npm run check`, and `npm run check:repo`.
- A PR is opened with `Closes #44` and this work item linked.

## Decisions and rationale
- Start from `origin/main` at `cefc1ce`, which already includes the app shell, process API routes, and the listed dependency PRs.
- Rebased onto updated `origin/main` at `78b28df` after PR #78 initially reported conflicts from concurrently merged graph-editing work.
- Treat the SAM/user task description as authoritative because the live GitHub issue #44 title/body currently differs from this assignment.
- Add an authenticated read-only `/api/settings` route for runtime workspace/deployment metadata. The browser can show the active environment, release, Slack scope, coordinator readiness, and configured deploy targets without exposing secret values or pretending to deploy directly.
- Keep deployment controls to reversible browser actions: refresh runtime metadata, reload workspace data, export the current model, and open the GitHub Actions deploy workflow.

## Changes
- Added `/api/settings` to `server/index.ts` after the auth guard, returning Slack auth status, configured channel scope, ChannelCoordinator readiness, release SHA, active environment, and staging/production Cloudflare target metadata.
- Expanded `src/app.tsx` settings view into a workspace configuration and deployment panel with status cards, target cards, runtime refresh, workspace reload, model export, deploy workflow link, and existing about action.
- Updated `src/style.css` for the larger settings/deployment surface and responsive layouts.
- Added server coverage for authenticated settings metadata and browser coverage for the new settings/deployment panel controls.

## Validation
- `npm ci`: passed, installed 232 locked packages with 0 vulnerabilities.
- `npm run fix`: first run failed because `ultracite` was not installed; after `npm ci`, one hook dependency diagnostic was fixed by making the settings refresh counter part of the request URL. Final run passed with no fixes applied.
- `npm run check`: passed lint, typecheck, fixture validation, 143 coverage tests, guardrail probes, PM migration smoke, and production build.
- `npm run check:repo`: first run failed because `ruff` was missing from the container. Installed Ruff 0.16.7 as a temporary local standalone binary.
- `PATH="/workspaces/ariadneos/.local-tools/ruff-0.16.7:$PATH" npm run check:repo`: first rerun passed repository context checks, Ruff, app checks, dependency audit, and isolated Worker/D1 smoke, then failed only because Playwright Chromium was not installed.
- `npm exec --no -- playwright install --with-deps chromium`: passed and installed the browser needed by the repo gate.
- `PATH="/workspaces/ariadneos/.local-tools/ruff-0.16.7:$PATH" npm run check:repo`: passed full quality, including work-item tests, Ruff, `npm run check`, dependency audit, isolated Worker/D1 smoke, and all 6 Chromium browser tests. The temporary `.local-tools` directory was removed after validation.
- After rebasing onto `origin/main` at `78b28df`, `npm run check`: passed lint, typecheck, fixture validation, 164 coverage tests, guardrail probes, PM migration smoke, and production build.
- After rebasing, `PATH="/workspaces/ariadneos/.local-tools/ruff-0.16.7:$PATH" npm run check:repo`: passed full quality, including work-item tests, Ruff, `npm run check`, dependency audit, isolated Worker/D1 smoke, and all 6 Chromium browser tests. The temporary `.local-tools` directory was removed again after validation.

## Risks and rollback
- Risk: issue #44 metadata in GitHub does not match the assigned task text, so the PR body will explicitly describe the implemented settings/deployment panel while still using the requested `Closes #44`.
- Rollback is expected to be a focused revert of the settings UI changes, tests, and this work item.

## Next steps
- Open a PR with this work item linked and `Closes #44`, then monitor CI. Staging verification is intentionally skipped per the time-critical user instruction.
