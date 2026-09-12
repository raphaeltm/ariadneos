# Agent Memory And Context Persistence

Status: in-progress
Owner: Codex via SAM task 01M2AZEGGVBBRVBG9JWVP7H7KH for Raphael
Source: User assignment to implement GitHub issue #40 as "Add agent memory and conversation context persistence." The live GitHub issue #40 currently describes a demo reset task, so this record follows the explicit SAM/user assignment and notes the issue metadata mismatch for review.
Branch: sam/implement-github-issue-40-p7h7kh

## Intent
Persist Ariadne agent conversation context in D1 and feed bounded recent history into agent-style `/api/ask` interactions without adding a second persistence path or deployment target.

## Acceptance criteria
- Agent ask turns are stored durably per authenticated user, workflow and thread, with request/answer metadata that supports replayable context.
- The model receives a bounded recent conversation window so long threads do not exceed the interaction context budget.
- Missing model configuration or exhausted quota still falls back to computed process statistics and records the degraded answer.
- Regression tests cover thread isolation, window limits, malformed thread identifiers and fallback persistence.

## Decisions and rationale
- Start from current `origin/main` on the SAM output branch; several unrelated PRs are open, so this change stays scoped to memory/context persistence.
- Use additive D1 tables because #18 established D1 as the graph/KB persistence layer and the project policy keeps this wave on Cloudflare storage.
- Keep semantic recall off for this slice because it would need a vector store that is not part of the time-critical scope.

## Changes
- Added migration `0008_agent_memory.sql` with scoped agent threads and ordered agent message rows for durable conversation history.
- Added `server/agent-memory.ts` with thread-key generation, public thread-id validation, append helpers and bounded recent context window reads.
- Threaded `/api/ask` through the memory helper so user turns are persisted before answering, bounded recent context is included in the AI prompt, and assistant turns are persisted for both AI and computed-summary fallback answers.
- Extended the PM migration smoke check to require the new agent memory tables.
- Added regression coverage for thread isolation, last-message limits, malformed thread identifiers, and fallback answer persistence.

## Validation
- `npm ci`: passed.
- `npm run fix`: passed after refactoring ask validation and test async patterns.
- `npx vitest run tests/agent-memory.test.ts tests/agent-memory-route.test.ts tests/request.test.ts`: passed, 17 tests.
- `npm run check`: passed; lint, typecheck, fixture validation, 137 coverage tests, guardrail probes, PM migration smoke through `0008_agent_memory.sql`, and production build.
- Initial `npm run check:repo`: failed because `ruff` was not installed in the container.
- Second `PATH="/workspaces/ariadneos/.local-tools/ruff-x86_64-unknown-linux-gnu:$PATH" npm run check:repo`: failed only because Playwright Chromium was not installed.
- Installed Ruff 0.16.7 from the Astral release archive and installed Playwright Chromium/system dependencies with `npm exec --no -- playwright install --with-deps chromium`.
- Final `PATH="/workspaces/ariadneos/.local-tools/ruff-x86_64-unknown-linux-gnu:$PATH" npm run check:repo`: passed work-item gates, Ruff, `npm run check`, dependency audit, isolated Worker/D1 smoke with migrations through `0008_agent_memory.sql`, and 6 Chromium browser tests.

## Risks and rollback
- Risk: the live GitHub issue #40 metadata does not match this assignment text; reviewers should confirm closing language before merge.
- Rollback: revert this PR; the migration is additive and can remain unused if already applied.

## Next steps
- Open the PR with `Closes #40`, monitor CI to green, skip staging verification per the explicit time-critical instruction, then merge when required checks are green.
