# App shell layout

Status: in-review
Owner: Codex agent for SAM task 01M2AWE14S8T9T4YBTA0MRKTAK
Source: GitHub issue #25 requests the `/app` shell, top bar, sidebar, responsive layout, workspace/project switching UI, and graph/inspector/settings navigation. The user requested starting from current main, using the existing React/Vite setup, preparing for #23 client state integration, skipping staging verification for speed, and delivering PR evidence.
Branch: sam/implement-github-issue-25-mrktak
PR: https://github.com/raphaeltm/ariadneos/pull/67

## Intent
Build the owned app shell component subtree around the current authenticated `/app` experience without changing the graph algorithm, authentication, backend APIs, marketing homepage, or #23 client-state internals. The shell should give downstream graph, inspector, and settings work a stable layout/navigation boundary.

## Acceptance criteria
- `/app` has an app shell component subtree with a top bar, sidebar, project switcher, workspace switcher, and graph canvas / inspector / settings navigation.
- Existing graph canvas, inspector, event log, simulation, export, ask, and Slack-auth gated `/app` behavior remain available.
- The responsive layout remains usable on narrow viewports without horizontal overflow.
- The implementation leaves a clear data-source boundary for #23 typed client scope/snapshot state.

## Decisions and rationale
- Use current `origin/main` as the base after #14 and #31 are already merged. Rebased again after #23 merged as PR #60 and #17 merged as PR #61, so this PR composes around the now-available client-state module boundary without copying or rewriting its internals.
- Preserve the existing `/api/model`, `/api/simulate`, and `/api/ask` flow so this shell can merge before the live snapshot/SSE backend route composition is complete.
- Represent project switching with the currently available workflow scopes, because those are the live selectable units on main today.
- Keep the shell component generic over string ids and option lists so #23's typed scope/store selectors can feed it without changing the visual frame.

## Changes
- Added `src/components/app-shell/app-shell.tsx` with the reusable app frame, top bar, workspace selector, project switcher, graph/inspector/settings navigation, help action, and action slots.
- Updated `src/app.tsx` to compose the authenticated `/app` experience through the shell, route sidebar navigation to the graph, inspector, and settings surfaces, and keep graph selections reflected in the shell nav.
- Added a settings panel for the current workspace scope while preserving the existing graph canvas, event log, inspector, simulation, export, ask, and about-dialog behavior.
- Updated `src/style.css` with desktop and mobile shell styles so navigation and switching controls remain reachable at narrow widths.
- Added browser coverage for shell navigation, project switching, and mobile overflow.

## Validation
- `npm ci`: passed, 232 packages installed/audited and 0 vulnerabilities found.
- `npm run fix`: initially failed on app complexity, a JSX ternary warning, and an unused shell local after applying safe fixes; passed after extracting run controls and cleaning diagnostics.
- `npm run check`: passed before the #23/#17 rebase: lint, typecheck, fixture validation, 97 coverage tests, guardrail probes, migration check, and production build.
- `npm run test:e2e`: first run passed API smoke but failed before browser assertions because Playwright Chromium was not installed locally. Installed the pinned Chromium browser with `npm exec --no -- playwright install --with-deps chromium`.
- `npm run test:e2e`: failed after the first shell build because the sidebar help action fell below the default desktop viewport and project buttons had extra accessible text; fixed the shell order/project labels and rebuilt.
- `npm run test:e2e`: passed after fixes: API smoke plus 6 Chromium browser tests, including the new shell navigation/project/mobile test.
- `PATH="/home/node/.local/bin:$PATH" npm run check:repo`: passed before the #23/#17 rebase, including work-item tests, Ruff, `npm run check`, dependency audit, isolated Worker/D1 smoke, and 6 Chromium browser tests.
- `PATH="/home/node/.local/bin:$PATH" python3 scripts/check_quality.py`: passed before the #23/#17 rebase with the same full quality flow.
- After rebasing onto current `origin/main` containing PR #60/#23 and PR #61/#17, `npm run fix`: passed with 79 files checked and no fixes applied.
- After rebasing, `npm run check`: passed lint, typecheck, fixture validation, 116 coverage tests across 13 files, guardrail probes, migration check, and production build.
- After rebasing, `PATH="/home/node/.local/bin:$PATH" npm run check:repo`: passed work-item tests, all-record context validation, Ruff, `npm run check`, dependency audit, isolated Worker/D1 smoke, and 6 Chromium browser tests.
- After rebasing, `PATH="/home/node/.local/bin:$PATH" python3 scripts/check_quality.py`: passed with the same full quality flow.

## Risks and rollback
- The live `/api/snapshot` and `/api/stream` route composition is still pending, so this PR uses the current main `/api/model` flow and prepares the shell boundary for #23's typed state injection instead of claiming live snapshot/SSE acceptance.
- Staging verification is intentionally skipped per the user's time-critical instruction. Rollback is a straight revert of the shell component, app composition, styles, browser test, and this work item.

## Next steps
- Monitor PR #67 CI and merge only when required checks are green. Staging verification remains skipped per the time-critical user instruction.
