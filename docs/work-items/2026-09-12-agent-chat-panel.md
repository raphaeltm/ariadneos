# Agent chat panel

Status: in-review
Owner: Codex agent for SAM task 01M2AZEN3EFXBF7G8Q9493QP7S
Source: User and SAM task request to implement GitHub issue #41 as "Expose agent chat UI panel with streaming responses" on branch `sam/implement-github-issue-41-93qp7s`, skipping staging verification for speed. GitHub issue #41 currently has a different title/body about simulation speed and preflight; this work item records the SAM/user-described chat-panel scope as the active assignment.
Branch: sam/implement-github-issue-41-93qp7s
PR: https://github.com/raphaeltm/ariadneos/pull/80

## Intent
Add an agent chat panel to the existing `/app` shell that lets a signed-in user submit prompts, see message history, and watch assistant responses render incrementally while keeping the implementation inside the current React/Vite client state and Cloudflare API boundaries.

## Acceptance criteria
- `/app` exposes an agent chat panel integrated with the app shell from issue #25.
- The panel includes message input, local history, pending/error states, and token-by-token streaming display.
- The UI consumes the existing client API/state boundaries from issue #23 and does not add a new backend, model provider, persistence path, or transport.
- `npm run fix`, `npm run check`, `npm run check:repo`, and the work-item context check have recorded outcomes before handoff.

## Decisions and rationale
- Implement the chat surface as a React component inside the existing `/app` shell because issue #25 already owns the navigation frame.
- Keep visible chat history in browser state for this slice. After rebasing, `main` includes backend agent memory, so `/api/ask` persists conversation context on its default user/workflow thread without this UI adding a separate persistence path.
- Render assistant output token by token on the client after `/api/ask` resolves. The current backend returns complete JSON and the task scope does not require adding a second transport or provider path.
- Use the issue #23 `createProductionApiAdapter().ask` boundary from the UI. The adapter sends typed `workflow_id` and `project_id` plus the legacy `workflow` field so it composes with the current demo endpoint.

## Changes
- Added `src/components/agent-chat/agent-chat-panel.tsx` with message input, prompt shortcuts, local user/assistant history, pending/error states, stop control, evidence action, and incremental token rendering.
- Added an `Agent chat` app-shell navigation item and a dedicated chat view within the existing explorer frame.
- Updated `/api/ask` request parsing to accept typed `workflow_id` bodies and reject malformed typed requests without throwing.
- Extended the typed client `RagAnswer` shape with the current demo answer metadata and made the production adapter include the legacy workflow field.
- Added chat panel styling and browser coverage for navigation, history, streaming cursor display, typed request payload, and evidence navigation.
- Rebased PR #80 onto `origin/main` after curation and agent-memory work landed, preserving curation controls and the backend memory path.
- Rebased PR #80 again onto `origin/main` at `b295d5d`, preserving the newer settings/deployment UI while keeping the chat view on the app-shell navigation path.
- Rebased PR #80 onto `origin/main` at `df55568` after Mastra tools and graph edit persistence consistency landed; no file conflicts were reported.
- Replaced the chat message ID helper's `Math.random()` usage with `crypto.randomUUID()` plus a monotonic fallback after CodeQL flagged insecure randomness.
- Rebased PR #80 onto `origin/main` at `36756a0`, preserving the new demo walkthrough and keyboard-accessible canvas while replacing the old assistant card with the Agent chat view.
- Fixed the latest canvas bridge conflict so clearing a keyboard selection forwards the cleared state back to the app and returns the shell to the graph view.

## Validation
- `npm ci`: passed; installed 232 packages and found 0 vulnerabilities.
- `npm run fix`: initially failed on a top-level regex diagnostic, app cognitive complexity, unsupported ARIA on the streaming cursor, and an effect dependency; passed after refactoring and cleanup.
- `npm run check`: passed lint, typecheck, fixture validation, 143 coverage tests, guardrail probes, migration check, and production build.
- `npm run check:repo`: initially failed because Ruff was not installed on PATH. Installed Ruff 0.16.7 into `/tmp/ariadneos-ruff`.
- `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: initially failed in Playwright because Chromium was not installed locally. Installed Chromium with `npm exec --no -- playwright install --with-deps chromium`.
- `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed work-item tests, all-record context validation, Ruff check/format, `npm run check`, dependency audit, isolated Worker/D1 smoke, and 7 Chromium browser tests.
- After rebasing onto `origin/main` at `22564d5`, `npm ci`: passed; installed 369 packages and found 0 vulnerabilities.
- After rebasing, `npm run fix`: passed with 112 files checked and no fixes applied.
- After rebasing, `npm run check`: passed lint, typecheck, fixture validation, 169 coverage tests across 22 files, guardrail probes, migration check, and production build.
- After rebasing, `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed work-item tests, all-record context validation, Ruff check/format, `npm run check`, dependency audit, isolated Worker/D1 smoke including agent-disabled smoke, and 7 Chromium browser tests.
- After rebasing onto `origin/main` at `b295d5d`, `npm run fix`: passed with 112 files checked and no fixes applied.
- After rebasing onto `origin/main` at `b295d5d`, `npm run check`: passed lint, typecheck, fixture validation, 171 coverage tests across 22 files, guardrail probes, migration check, and production build.
- After rebasing onto `origin/main` at `b295d5d`, `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed work-item tests, all-record context validation, Ruff check/format, `npm run check`, dependency audit, isolated Worker/D1 smoke including agent-disabled smoke, and 7 Chromium browser tests.
- After rebasing onto `origin/main` at `df55568`, `npm run fix`: passed with 116 files checked and no fixes applied.
- After rebasing onto `origin/main` at `df55568`, `npm run check`: passed lint, typecheck, fixture validation, 183 coverage tests across 24 files, guardrail probes, migration check, and production build.
- After rebasing onto `origin/main` at `df55568`, `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed work-item tests, all-record context validation, Ruff check/format, `npm run check`, dependency audit, isolated Worker/D1 smoke including the agent-tools migration and agent-disabled smoke, and 7 Chromium browser tests.
- After the CodeQL insecure-randomness fix, `npm run fix`: passed with 116 files checked and no fixes applied.
- After the CodeQL insecure-randomness fix, `npm run check`: passed lint, typecheck, fixture validation, 183 coverage tests across 24 files, guardrail probes, migration check, and production build.
- After the CodeQL insecure-randomness fix, `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed work-item tests, all-record context validation, Ruff check/format, `npm run check`, dependency audit, isolated Worker/D1 smoke including the agent-tools migration and agent-disabled smoke, and 7 Chromium browser tests.
- After rebasing onto `origin/main` at `36756a0`, `npm run fix`: passed with 123 files checked and no fixes applied.
- After rebasing onto `origin/main` at `36756a0`, `npm run check`: passed lint, typecheck, fixture validation, 190 coverage tests across 26 files, guardrail probes, migration check, and production build.
- After rebasing onto `origin/main` at `36756a0`, first `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: failed because the rebased upstream keyboard-canvas browser test still used the old canvas aria label, then because the app bridge did not forward the cleared workflow selection. Updated the selector and bridge behavior.
- After the canvas bridge fix, `npm run fix`: passed with 123 files checked and no fixes applied.
- After the canvas bridge fix, `npm run check`: passed lint, typecheck, fixture validation, 190 coverage tests across 26 files, guardrail probes, migration check, and production build.
- After the canvas bridge fix, `PATH="/tmp/ariadneos-ruff:$PATH" npm run check:repo`: passed work-item tests, all-record context validation, Ruff check/format, `npm run check`, dependency audit, isolated Worker/D1 smoke including the agent-tools migration and agent-disabled smoke, and 14 Chromium browser tests.

## Risks and rollback
- Staging verification is intentionally skipped per the user's time-critical instruction.
- Roll back by reverting the chat panel component, related app shell wiring, styles, tests, and this work item.

## Next steps
- Monitor PR #80 CI and merge only when green. Staging verification remains skipped per the time-critical user instruction.
